const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { EventEmitter } = require('events')

const MIN_SEG = 1 << 20 // never split into pieces smaller than 1 MiB
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sanitize(name) {
  let n = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 180)
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = '_' + n
  return n || 'download'
}

function fileNameFrom(res, url) {
  const cd = res.headers.get('content-disposition') || ''
  let m = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  let n = null
  if (m) {
    try { n = decodeURIComponent(m[1]) } catch { /* bad escape, fall through */ }
  }
  if (!n) {
    m = /filename="?([^";]+)"?/i.exec(cd)
    n = m && m[1]
  }
  if (!n) {
    try { n = decodeURIComponent(path.basename(new URL(res.url || url).pathname)) } catch { /* use default */ }
  }
  return sanitize(n)
}

function uniquePath(dir, name, taken = new Set()) {
  let p = path.join(dir, name)
  if (!fs.existsSync(p) && !taken.has(p)) return p
  const { name: base, ext } = path.parse(name)
  for (let i = 1; ; i++) {
    p = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(p) && !taken.has(p)) return p
  }
}

// Network and disk errors in plain words, for the notices and dialogs.
function friendly(e) {
  const code = e?.cause?.code || e?.code
  const text = String(e?.message || e)
  const byCode = {
    ENOTFOUND: 'The server address could not be found.',
    ECONNREFUSED: 'The server refused the connection.',
    ECONNRESET: 'The connection was cut before the file finished.',
    ETIMEDOUT: 'The server took too long to answer.',
    UND_ERR_CONNECT_TIMEOUT: 'The server took too long to answer.',
    ENOSPC: 'The disk is full.',
    EACCES: 'No permission to write to that folder.',
    EPERM: 'No permission to write to that folder.',
  }
  if (byCode[code]) return byCode[code]
  if (text === 'terminated') return 'The connection was cut before the file finished.'
  if (text === 'fetch failed') return 'Could not reach the server.'
  return text
}

function checkUrl(url) {
  let u
  try { u = new URL(url) } catch { throw new Error('That does not look like a web address.') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https links are supported.')
  return u.href
}

// Ask for byte 0 only: a 206 proves the server supports ranges and tells us the total size.
async function probe(url, headers = {}) {
  const res = await fetch(url, { headers: { ...headers, Range: 'bytes=0-0' }, redirect: 'follow' }).catch((e) => { throw new Error(friendly(e)) })
  let size = null
  let resumable = false
  if (res.status === 206) {
    const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '')
    if (m) { size = Number(m[1]); resumable = true }
  } else if (res.ok) {
    const len = res.headers.get('content-length')
    size = len ? Number(len) : null
  } else {
    res.body?.cancel().catch(() => {})
    throw new Error(`The server replied ${res.status}.`)
  }
  const out = {
    finalUrl: res.url || url,
    size,
    resumable,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    fileName: fileNameFrom(res, url),
  }
  res.body?.cancel().catch(() => {})
  return out
}

function planSegments(size, resumable, connections) {
  if (!resumable || !size || size < 2 * MIN_SEG) return [{ idx: 0, start: 0, end: size ? size - 1 : -1, done: 0, status: 'pending' }]
  const n = Math.max(1, Math.min(connections, Math.floor(size / MIN_SEG)))
  const base = Math.floor(size / n)
  return Array.from({ length: n }, (_, i) => ({
    idx: i,
    start: i * base,
    end: i === n - 1 ? size - 1 : (i + 1) * base - 1,
    done: 0,
    status: 'pending',
  }))
}

class Manager extends EventEmitter {
  constructor(store, defaults) {
    super()
    this.store = store
    this.defaults = defaults
    this.jobs = new Map()
    this.tools = null // set by the app: the video helpers (see tools.cjs)
    this.bucket = 0
    this.bucketAt = Date.now()
    for (const d of Object.values(store.data.downloads)) {
      if (d.status === 'downloading') d.status = 'paused' // app closed mid-download
    }
  }

  settings() { return { ...this.defaults, ...this.store.data.settings } }

  setSetting(key, value) {
    this.store.data.settings[key] = value
    this.store.save()
    if (key === 'max_parallel') this.schedule()
  }

  list() {
    return Object.values(this.store.data.downloads)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map(({ headers, ...rest }) => rest) // headers can hold cookies: never leave the main process
  }

  get(id) {
    const d = this.store.data.downloads[id]
    if (!d) throw new Error('That download no longer exists.')
    return d
  }

  touch(d) {
    d.updated_at = new Date().toISOString()
    this.store.save()
    this.emit('change')
  }

  async add(rawUrl, opts = {}) {
    const url = checkUrl(rawUrl)
    const s = this.settings()
    const headers = opts.headers || {}
    const info = await probe(url, headers)
    const dir = opts.saveDir || s.download_dir
    fs.mkdirSync(dir, { recursive: true })
    const taken = new Set(Object.values(this.store.data.downloads).map((d) => d.save_path))
    const savePath = uniquePath(dir, opts.fileName ? sanitize(opts.fileName) : info.fileName, taken)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const d = {
      id, url, final_url: info.finalUrl, file_name: path.basename(savePath), save_path: savePath,
      temp_path: path.join(s.temp_dir, id + '.part'),
      size_bytes: info.size, downloaded_bytes: 0, status: 'queued', connections: s.max_connections,
      speed_limit: null, resumable: info.resumable, etag: info.etag, last_modified: info.lastModified,
      headers, error: null, created_at: now, updated_at: now, completed_at: null, segments: [], speed: 0,
    }
    this.store.data.downloads[id] = d
    this.touch(d)
    this.schedule()
    return id
  }

  schedule() {
    const max = this.settings().max_parallel
    let active = [...this.jobs.keys()].length
    const queued = Object.values(this.store.data.downloads)
      .filter((d) => d.status === 'queued' && !this.jobs.has(d.id))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    for (const d of queued) {
      if (active >= max) break
      active++
      this.start(d)
    }
  }

  reset(d) {
    d.segments = []
    d.downloaded_bytes = 0
    if (d.kind === 'media') return this.cleanupMedia(d)
    fs.rmSync(d.temp_path, { force: true })
  }

  // Half-finished pieces yt-dlp leaves next to the final file.
  cleanupMedia(d) {
    const { partialFiles } = require('./media.cjs')
    for (const f of partialFiles(path.dirname(d.save_path), d.media.baseName)) fs.rmSync(f, { force: true })
  }

  // A video or audio from a web page. media: { kind: 'video' | 'audio', height?, format?, needsFfmpeg?, size? }
  async addMedia(rawUrl, opts = {}) {
    const url = checkUrl(rawUrl)
    const m = opts.media || {}
    if (m.kind !== 'video' && m.kind !== 'audio') throw new Error('That value is not allowed.')
    const s = this.settings()
    const dir = opts.saveDir || s.download_dir
    fs.mkdirSync(dir, { recursive: true })
    const ext = m.kind === 'audio' ? (m.format === 'mp3' ? 'mp3' : 'm4a') : 'mp4' // the real ending is known when it is finished
    const taken = new Set(Object.values(this.store.data.downloads).map((x) => x.save_path))
    const wanted = sanitize(String(opts.fileName || opts.title || 'video').replace(/\.[a-z0-9]{2,4}$/i, '')).slice(0, 150)
    const savePath = uniquePath(dir, `${wanted}.${ext}`, taken)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const d = {
      id, kind: 'media', url, final_url: url, file_name: path.basename(savePath), save_path: savePath, temp_path: '',
      size_bytes: m.size || null, downloaded_bytes: 0, status: 'queued', connections: 1, speed_limit: null, resumable: true,
      etag: null, last_modified: null, headers: opts.headers || {}, error: null, created_at: now, updated_at: now, completed_at: null,
      segments: [], speed: 0,
      media: { kind: m.kind, height: Number.isInteger(m.height) ? m.height : 0, format: m.format === 'mp3' ? 'mp3' : 'original', needsFfmpeg: !!m.needsFfmpeg, baseName: path.basename(savePath, path.extname(savePath)) },
    }
    this.store.data.downloads[id] = d
    this.touch(d)
    this.schedule()
    return id
  }

  async finishMedia(d) {
    d.status = 'completed'
    d.completed_at = new Date().toISOString()
    d.speed = 0
    delete d.note
    delete d.noteProgress
    this.touch(d)
    this.emit('completed', d)
  }

  start(d) {
    const job = { abort: new AbortController(), bytes: 0, fh: null }
    this.jobs.set(d.id, job)
    d.status = 'downloading'
    d.error = null
    this.touch(d)
    this.ensureTicker()
    this.run(d, job)
      .catch((e) => {
        if (job.abort.signal.aborted) return
        job.abort.abort()
        d.status = 'failed'
        d.error = friendly(e)
        d.speed = 0
        this.touch(d)
        this.emit('failed', d)
      })
      .finally(async () => {
        await job.fh?.close().catch(() => {})
        if (this.jobs.get(d.id) === job) this.jobs.delete(d.id)
        this.schedule()
      })
  }

  async run(d, job) {
    if (d.kind === 'media') return require('./media.cjs').runMedia(this, d, job) // a video or audio fetched by yt-dlp
    // A half-finished file is only safe to continue if the server still has the same file.
    if (d.downloaded_bytes > 0) {
      if (!d.resumable) this.reset(d)
      else {
        const p = await probe(d.final_url || d.url, d.headers)
        if (p.etag !== d.etag || p.lastModified !== d.last_modified || p.size !== d.size_bytes) this.reset(d)
      }
    }
    if (!d.segments.length) d.segments = planSegments(d.size_bytes, d.resumable, d.connections)
    fs.mkdirSync(path.dirname(d.temp_path), { recursive: true })
    const existed = fs.existsSync(d.temp_path)
    job.fh = await fs.promises.open(d.temp_path, existed ? 'r+' : 'w+')
    if (!existed && d.size_bytes) await job.fh.truncate(d.size_bytes)
    await Promise.all(d.segments.filter((s) => s.status !== 'done').map((s) => this.runSegment(d, s, job)))
    if (job.abort.signal.aborted) return
    await job.fh.close()
    job.fh = null
    if (d.size_bytes && d.segments.some((s) => s.end >= 0) && d.downloaded_bytes !== d.size_bytes) {
      throw new Error('The file ended up the wrong size.')
    }
    await this.finalize(d)
  }

  async runSegment(d, s, job) {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.fetchSegment(d, s, job)
        s.status = 'done'
        return
      } catch (e) {
        if (job.abort.signal.aborted) return
        if (attempt >= 3) throw e
        await sleep(500 * 2 ** attempt)
      }
    }
  }

  async fetchSegment(d, s, job) {
    s.status = 'active'
    const from = s.start + s.done
    const headers = { ...d.headers }
    if (d.resumable) headers.Range = `bytes=${from}-${s.end >= 0 ? s.end : ''}`
    const res = await fetch(d.final_url || d.url, { headers, signal: job.abort.signal })
    if (d.resumable && res.status !== 206) throw new Error('The server stopped supporting partial downloads.')
    if (!res.ok) throw new Error(`The server replied ${res.status}.`)
    const reader = res.body.getReader()
    let pos = from
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await this.throttle(value.length)
      if (job.abort.signal.aborted) return
      await job.fh.write(value, 0, value.length, pos)
      pos += value.length
      s.done += value.length
      d.downloaded_bytes += value.length
      job.bytes += value.length
    }
    if (s.end >= 0 && s.start + s.done !== s.end + 1) throw new Error('The connection closed early.')
    if (s.end < 0) s.end = s.start + s.done - 1 // size was unknown, now it is
  }

  // Shared limiter: every write adds to a debt and waits until the debt is paid at the limit rate.
  async throttle(n) {
    const limit = this.settings().speed_limit_kbps * 1024
    if (!limit) return
    const now = Date.now()
    this.bucket = Math.min(limit, this.bucket + ((now - this.bucketAt) / 1000) * limit) - n
    this.bucketAt = now
    if (this.bucket < 0) await sleep((-this.bucket / limit) * 1000)
  }

  async finalize(d) {
    const taken = new Set(Object.values(this.store.data.downloads).filter((x) => x.id !== d.id).map((x) => x.save_path))
    d.save_path = uniquePath(path.dirname(d.save_path), path.basename(d.save_path), taken)
    d.file_name = path.basename(d.save_path)
    try {
      await fs.promises.rename(d.temp_path, d.save_path)
    } catch (e) {
      if (e.code !== 'EXDEV') throw e // temp and target on different drives
      await fs.promises.copyFile(d.temp_path, d.save_path)
      await fs.promises.unlink(d.temp_path)
    }
    d.status = 'completed'
    d.completed_at = new Date().toISOString()
    d.speed = 0
    d.segments = []
    this.touch(d)
    this.emit('completed', d)
  }

  ensureTicker() {
    if (this.ticker) return
    // Five updates a second, with a smoothed speed, so progress windows move steadily instead of in jumps.
    this.ticks = 0
    this.ticker = setInterval(() => {
      const now = Date.now()
      this.ticks++
      for (const [id, job] of this.jobs) {
        const d = this.store.data.downloads[id]
        const dt = Math.max(0.05, (now - (job.last || now - 200)) / 1000)
        job.last = now
        const inst = job.bytes / dt
        job.bytes = 0
        job.ema = job.ema == null ? inst : job.ema * 0.75 + inst * 0.25
        d.speed = Math.round(job.ema)
      }
      this.emit('change')
      if (this.ticks % 10 === 0) this.store.save() // writing the file every 2 s is enough, and keeps the disk and CPU quiet
      if (!this.jobs.size) {
        clearInterval(this.ticker)
        this.ticker = null
      }
    }, 200)
    this.ticker.unref?.()
  }

  stopJob(id) {
    const job = this.jobs.get(id)
    if (job) job.abort.abort()
  }

  pause(id) {
    const d = this.get(id)
    if (d.status !== 'downloading' && d.status !== 'queued') return
    this.stopJob(id)
    d.status = 'paused'
    d.speed = 0
    this.touch(d)
    this.schedule()
  }

  resume(id) {
    const d = this.get(id)
    if (d.status !== 'paused' && d.status !== 'failed') return
    d.status = 'queued'
    d.error = null
    this.touch(d)
    this.schedule()
  }

  retry(id) {
    const d = this.get(id)
    if (d.status === 'downloading') return
    this.reset(d)
    d.status = 'queued'
    d.error = null
    this.touch(d)
    this.schedule()
  }

  cancel(id) {
    const d = this.get(id)
    if (d.status === 'completed') return
    this.stopJob(id)
    d.status = 'cancelled'
    d.speed = 0
    this.touch(d)
    setTimeout(() => (d.kind === 'media' ? this.cleanupMedia(d) : fs.rmSync(d.temp_path, { force: true })), 300) // let the open file or program finish closing first
    this.schedule()
  }

  remove(id, deleteFile) {
    const d = this.get(id)
    this.stopJob(id)
    setTimeout(() => (d.kind === 'media' ? this.cleanupMedia(d) : fs.rmSync(d.temp_path, { force: true })), 300)
    if (deleteFile && d.status === 'completed') fs.rmSync(d.save_path, { force: true })
    delete this.store.data.downloads[id]
    this.store.save()
    this.emit('change')
    this.schedule()
  }
}

module.exports = { Manager, probe, planSegments, sanitize, checkUrl, friendly }
