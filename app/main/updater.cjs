// Updates for GDM itself. A small file on a web address you choose (latest.json) names the newest version, where its
// installer is and the installer's SHA-256. GDM downloads it quietly, checks it, and installs it when you restart or close.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { EventEmitter } = require('events')
const { friendly } = require('./engine.cjs')

const MAX_INSTALLER = 600 * 1024 * 1024

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// Is a newer than b? (1.10.0 is newer than 1.9.0; text such as "-beta" is ignored)
function isNewer(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

// Only https, except for this computer itself (tests and local servers).
function checkAddress(text) {
  let url
  try { url = new URL(text) } catch { throw new Error('The update address must start with https://.') }
  const here = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol === 'https:' || (url.protocol === 'http:' && here)) return url
  throw new Error('The update address must start with https://.')
}

const sha256File = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256')
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
})

const KNOWN = new Set([
  'The update address must start with https://.', 'The update file is not valid.', 'Could not check for updates.', 'Could not download the update.',
  'Updates are not set up yet. Enter the address of the update file.', 'The download did not match its checksum, so it was not used.',
])
const wording = (e) => (KNOWN.has(e.message) ? e.message : e.name === 'TimeoutError' || e.name === 'AbortError' ? 'The server took too long to answer.' : friendly(e) === e.message && !/fetch|network|ECONN|ENOTFOUND/i.test(e.message) ? 'Could not check for updates.' : friendly(e))

class Updater extends EventEmitter {
  // feedUrl: a function returning the address of latest.json (it may change in Settings)
  constructor({ current, dir, feedUrl }) {
    super()
    this.dir = dir
    this.feedUrl = feedUrl
    this.info = null
    this.running = false
    this.state = { status: 'idle', current, version: null, progress: 0, notes: null, error: null }
  }

  set(patch) {
    Object.assign(this.state, patch)
    this.emit('change', { ...this.state })
  }

  async check() {
    if (this.running) return
    this.running = true
    try {
      const feed = this.feedUrl()
      if (!feed) throw new Error('Updates are not set up yet. Enter the address of the update file.')
      const url = checkAddress(feed)
      this.set({ status: 'checking', error: null, progress: 0 })
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error('Could not check for updates.')
      const text = await res.text()
      let info
      try { info = JSON.parse(text) } catch { throw new Error('The update file is not valid.') }
      if (text.length > 100000 || !parseVersion(info?.version) || typeof info.url !== 'string' || !/^[0-9a-f]{64}$/i.test(String(info.sha256))) throw new Error('The update file is not valid.')
      const installer = checkAddress(new URL(info.url, url).href) // the installer must be https too
      if (!isNewer(info.version, this.state.current)) { this.info = null; return this.set({ status: 'none', version: null, notes: null }) }
      this.info = { version: info.version, url: installer, sha256: String(info.sha256).toLowerCase() }
      this.set({ status: 'available', version: info.version, notes: info.notes && typeof info.notes === 'object' ? info.notes : null })
      await this.download()
    } catch (e) {
      this.set({ status: 'error', error: wording(e) })
    } finally {
      this.running = false
    }
  }

  async download() {
    const { version, url, sha256 } = this.info
    fs.mkdirSync(this.dir, { recursive: true })
    const file = path.join(this.dir, `gdm-setup-${version}.exe`)
    if (fs.existsSync(file) && (await sha256File(file)) === sha256) return this.set({ status: 'ready', file, progress: 100 }) // fetched on an earlier run
    const tmp = file + '.download'
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error('Could not download the update.')
      const total = Number(res.headers.get('content-length')) || 0
      if (total > MAX_INSTALLER) throw new Error('Could not download the update.')
      this.set({ status: 'downloading', progress: 0 })
      const hash = crypto.createHash('sha256')
      const out = fs.createWriteStream(tmp)
      let got = 0
      try {
        for await (const chunk of res.body) {
          got += chunk.length
          if (got > MAX_INSTALLER) throw new Error('Could not download the update.')
          hash.update(chunk)
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
          if (total) this.set({ progress: Math.floor((got / total) * 100) })
        }
      } finally {
        await new Promise((r) => out.end(r))
      }
      if (hash.digest('hex') !== sha256) throw new Error('The download did not match its checksum, so it was not used.')
      fs.renameSync(tmp, file)
      this.set({ status: 'ready', file, progress: 100 })
    } catch (e) {
      fs.rmSync(tmp, { force: true })
      throw e
    }
  }

  // Starts the installer we downloaded and checked, after checking it once more. The caller then quits.
  async installIfReady(run) {
    if (this.state.status !== 'ready' || !this.info) return false
    const file = this.state.file
    if (path.dirname(file) !== this.dir || (await sha256File(file)) !== this.info.sha256) return false
    run(file, ['/S', '--updated', '--force-run']) // silent install, then start GDM again
    return true
  }
}

module.exports = { Updater, isNewer, parseVersion, checkAddress, sha256File }
