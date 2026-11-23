// The two helper programs behind video and audio downloads: yt-dlp (reads the page, lists the qualities, fetches the streams)
// and ffmpeg (joins picture and sound, converts to MP3). They are not shipped inside GDM, which keeps the installer small.
// They are fetched once, from their own public release pages, and checked against the published checksum before use.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { sha256File } = require('./updater.cjs')

const YTDLP_ASSET = 'yt-dlp.exe'
const FFMPEG_ASSET = 'ffmpeg-master-latest-win64-lgpl.zip'

class Tools {
  // base: where releases come from (tests point it at a local server). script: a stand-in for yt-dlp used by tests.
  constructor({ dir, base = 'https://github.com', script = process.env.GDM_YTDLP_SCRIPT } = {}) {
    this.dir = dir
    this.base = base
    this.script = script
    this.installing = null
  }

  ytdlpFile() { return path.join(this.dir, YTDLP_ASSET) }
  ffmpegFile() { return path.join(this.dir, 'ffmpeg.exe') }

  ytdlpCommand() {
    if (this.script) return { cmd: process.execPath, args: [this.script], env: { ELECTRON_RUN_AS_NODE: '1' } }
    return fs.existsSync(this.ytdlpFile()) ? { cmd: this.ytdlpFile(), args: [], env: {} } : null
  }

  ffmpegPath() { return fs.existsSync(this.ffmpegFile()) ? this.ffmpegFile() : null }

  async download(url, dest, onProgress) {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error('Could not download the helper.')
    const total = Number(res.headers.get('content-length')) || 0
    const hash = crypto.createHash('sha256')
    const out = fs.createWriteStream(dest)
    let got = 0
    try {
      for await (const chunk of res.body) {
        hash.update(chunk)
        got += chunk.length
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
        if (total && onProgress) onProgress(Math.floor((got / total) * 100))
      }
    } finally {
      await new Promise((r) => out.end(r))
    }
    return hash.digest('hex')
  }

  // The release publishes a list of "checksum  file name"; ours must match, or the file is thrown away.
  async expectedSum(sumsUrl, assetName) {
    const res = await fetch(sumsUrl, { redirect: 'follow' })
    if (!res.ok) throw new Error('Could not verify the download.')
    for (const line of (await res.text()).split(/\r?\n/)) {
      const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line)
      if (m && path.basename(m[2]) === assetName) return m[1].toLowerCase()
    }
    throw new Error('Could not verify the download.')
  }

  async fetchVerified(releaseUrl, assetName, sumsName, onProgress) {
    fs.mkdirSync(this.dir, { recursive: true })
    const tmp = path.join(this.dir, assetName + '.download')
    try {
      const actual = await this.download(`${releaseUrl}/${assetName}`, tmp, onProgress)
      const expected = await this.expectedSum(`${releaseUrl}/${sumsName}`, assetName)
      if (actual !== expected) throw new Error('The download did not match its checksum, so it was not used.')
      return { file: tmp, sum: expected }
    } catch (e) {
      fs.rmSync(tmp, { force: true })
      throw e
    }
  }

  once(key, fn) { // one install at a time, however many downloads ask
    this.installing ||= {}
    return (this.installing[key] ||= fn().finally(() => { delete this.installing[key] }))
  }

  ensureYtdlp(onProgress) {
    if (this.ytdlpCommand()) return Promise.resolve()
    return this.once('ytdlp', async () => {
      const { file } = await this.fetchVerified(`${this.base}/yt-dlp/yt-dlp/releases/latest/download`, YTDLP_ASSET, 'SHA2-256SUMS', onProgress)
      fs.renameSync(file, this.ytdlpFile())
    })
  }

  ensureFfmpeg(onProgress) {
    if (this.ffmpegPath()) return Promise.resolve()
    return this.once('ffmpeg', async () => {
      const { file: zip, sum } = await this.fetchVerified(`${this.base}/yt-dlp/FFmpeg-Builds/releases/latest/download`, FFMPEG_ASSET, 'checksums.sha256', onProgress)
      const work = path.join(this.dir, 'ffmpeg-unpack')
      fs.rmSync(work, { recursive: true, force: true })
      fs.mkdirSync(work, { recursive: true })
      try {
        // Windows ships tar, which also reads zip files; only ffmpeg itself is taken out
        await new Promise((resolve, reject) => {
          // the tar that ships with Windows (it reads zip); another tar earlier on the PATH, such as Git's, may not
          const tar = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe')
          const p = spawn(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', work, '*/bin/ffmpeg.exe'], { windowsHide: true, stdio: 'ignore' })
          p.on('error', reject)
          p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Could not unpack the helper.'))))
        })
        const top = fs.readdirSync(work)[0]
        const exe = path.join(work, top, 'bin', 'ffmpeg.exe')
        if (!top || !fs.existsSync(exe)) throw new Error('Could not unpack the helper.')
        fs.renameSync(exe, this.ffmpegFile())
        fs.writeFileSync(path.join(this.dir, 'ffmpeg.json'), JSON.stringify({ zipSha: sum })) // which build this is, so a newer one can be recognised
      } finally {
        fs.rmSync(work, { recursive: true, force: true })
        fs.rmSync(zip, { force: true })
      }
    })
  }

  run(args, timeout = 60000) {
    return new Promise((resolve) => {
      const cmd = this.ytdlpCommand()
      if (!cmd) return resolve({ code: -1, out: '' })
      const p = spawn(cmd.cmd, [...cmd.args, ...args], { env: { ...process.env, ...cmd.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      p.stdout.setEncoding('utf8').on('data', (d) => { out += d })
      p.stderr.setEncoding('utf8').on('data', (d) => { out += d })
      const timer = setTimeout(() => p.kill(), timeout)
      p.on('error', () => { clearTimeout(timer); resolve({ code: -1, out }) })
      p.on('close', (code) => { clearTimeout(timer); resolve({ code, out }) })
    })
  }

  async version() { const r = await this.run(['--version'], 15000); return r.code === 0 ? r.out.trim().split(/\r?\n/)[0] : null }

  // Sites change often, so the helpers are kept current: compare what is installed with the checksum published for the
  // newest release, and fetch (and check) the new file only when they differ. A helper that is in use is left for next time.
  async updateHelpers({ ffmpeg = true, busy = false } = {}) {
    if (this.script) return { ytdlp: 'current', ffmpeg: 'current' } // the test stand-in has nothing to update
    const out = { ytdlp: 'missing', ffmpeg: 'missing' }
    const yt = `${this.base}/yt-dlp/yt-dlp/releases/latest/download`
    if (fs.existsSync(this.ytdlpFile())) {
      if ((await sha256File(this.ytdlpFile())) === (await this.expectedSum(`${yt}/SHA2-256SUMS`, YTDLP_ASSET))) out.ytdlp = 'current'
      else if (busy) out.ytdlp = 'busy'
      else {
        const { file } = await this.fetchVerified(yt, YTDLP_ASSET, 'SHA2-256SUMS')
        try { fs.renameSync(file, this.ytdlpFile()); out.ytdlp = 'updated' } catch { fs.rmSync(file, { force: true }); out.ytdlp = 'busy' }
      }
    }
    if (ffmpeg && this.ffmpegPath()) {
      const ff = `${this.base}/yt-dlp/FFmpeg-Builds/releases/latest/download`
      const expected = await this.expectedSum(`${ff}/checksums.sha256`, FFMPEG_ASSET)
      let have = null
      try { have = JSON.parse(fs.readFileSync(path.join(this.dir, 'ffmpeg.json'), 'utf8')).zipSha } catch { /* installed before builds were recorded */ }
      if (have === expected) out.ffmpeg = 'current'
      else if (busy) out.ffmpeg = 'busy'
      else {
        fs.rmSync(this.ffmpegFile(), { force: true }) // ensureFfmpeg fetches and unpacks the new build
        try { await this.ensureFfmpeg(); out.ffmpeg = 'updated' } catch (e) { out.ffmpeg = 'failed'; throw e }
      }
    }
    return out
  }

  updateYtdlp() { return this.updateHelpers({ ffmpeg: false }) }

  async status() {
    return { ytdlp: { installed: !!this.ytdlpCommand(), version: this.ytdlpCommand() ? await this.version() : null }, ffmpeg: { installed: !!this.ffmpegPath() } }
  }
}

module.exports = { Tools, YTDLP_ASSET, FFMPEG_ASSET }
