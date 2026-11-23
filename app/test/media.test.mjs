import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { buildDownloadArgs, parseProgress, parseDestination, friendlyMediaError, probeMedia } = require('../main/media.cjs')
const { Tools } = require('../main/tools.cjs')
const { Manager } = require('../main/engine.cjs')
const { Store } = require('../main/store.cjs')

const FAKE = path.resolve('test/fake-ytdlp.cjs')
let tmp
const pattern = (offset, n) => Buffer.from(Array.from({ length: n }, (_, i) => (offset + i) % 251))
const waitFor = async (fn, ms = 20000) => {
  const t0 = Date.now()
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)) }
}

beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-media-')) })
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

function mk(opts = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'm-'))
  const toolsDir = path.join(dir, 'tools')
  fs.mkdirSync(toolsDir)
  if (opts.ffmpeg) fs.writeFileSync(path.join(toolsDir, 'ffmpeg.exe'), 'placeholder') // present, so nothing is fetched
  const tools = new Tools({ dir: toolsDir, script: FAKE })
  const m = new Manager(new Store(path.join(dir, 's.json')), { download_dir: path.join(dir, 'out'), temp_dir: path.join(dir, 'tmp'), max_connections: 2, max_parallel: 3, speed_limit_kbps: 0 })
  m.tools = tools
  return { m, tools, dir, out: path.join(dir, 'out') }
}

describe('reading a page', () => {
  it('lists every quality, best first, and says which need the conversion helper', async () => {
    const { tools } = mk()
    const info = await probeMedia(tools, 'https://example.com/watch?v=ok')
    expect(info.title).toBe('Sample: the video / part 2')
    expect(info.site).toBe('Youtube')
    expect(info.video.map((v) => v.height)).toEqual([1080, 720, 360])
    const [p1080, p720, p360] = info.video
    expect(p1080).toMatchObject({ fps: 60, needsFfmpeg: true }) // picture and sound are separate: must be joined
    expect(p720).toMatchObject({ fps: 0, ext: 'mp4', needsFfmpeg: false, size: 12000000 }) // a ready-made file exists
    expect(p360.needsFfmpeg).toBe(false)
    expect(p1080.size).toBe(50000000 + 3000000) // best picture plus the best sound (M4A wins the close call)
  })
  it('offers audio: the original file and MP3', async () => {
    const { tools } = mk()
    const info = await probeMedia(tools, 'https://example.com/watch?v=ok')
    expect(info.audio.map((a) => a.id)).toEqual(['original', 'mp3'])
    expect(info.audio[0]).toMatchObject({ ext: 'm4a', needsFfmpeg: false })
    expect(info.audio[1].needsFfmpeg).toBe(true)
  })
  it('says so when the page has no video, needs a login, or is a list', async () => {
    const { tools } = mk()
    await expect(probeMedia(tools, 'https://example.com/unsupported')).rejects.toThrow('No video was found on this page.')
    await expect(probeMedia(tools, 'https://example.com/private')).rejects.toThrow('signed in')
    await expect(probeMedia(tools, 'https://example.com/playlist')).rejects.toThrow('list of videos')
  })
  it('passes the browser session (cookies, referrer) to the reader', async () => {
    const log = path.join(tmp, 'probe.log')
    process.env.FAKE_YTDLP_LOG = log
    const { tools } = mk()
    await probeMedia(tools, 'https://example.com/watch?v=ok', { Cookie: 'sid=abc', Referer: 'https://example.com/' })
    delete process.env.FAKE_YTDLP_LOG
    const args = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').at(-1)).args
    expect(args).toContain('Cookie:sid=abc')
    expect(args.at(-1)).toBe('https://example.com/watch?v=ok')
    expect(args.at(-2)).toBe('--') // a link can never be read as an option
  })
})

describe('the command for one download', () => {
  const base = { url: 'https://example.com/v', outDir: 'C:\\out', baseName: 'My 50% video; rm -rf' }
  it('with the helper: the best picture up to the chosen height, joined with the best sound, as MP4', () => {
    const a = buildDownloadArgs({ ...base, media: { kind: 'video', height: 720 }, ffmpegPath: 'C:\\t\\ffmpeg.exe' })
    expect(a[a.indexOf('-f') + 1]).toContain('bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]')
    expect(a).toContain('--merge-output-format')
    expect(a[a.indexOf('--ffmpeg-location') + 1]).toBe('C:\\t\\ffmpeg.exe')
  })
  it('without the helper: only ready-made single files', () => {
    const a = buildDownloadArgs({ ...base, media: { kind: 'video', height: 720 } })
    expect(a[a.indexOf('-f') + 1]).toBe('best[height<=720]/best')
    expect(a).not.toContain('--merge-output-format')
  })
  it('best available means no height limit', () => {
    const a = buildDownloadArgs({ ...base, media: { kind: 'video', height: 0 }, ffmpegPath: 'x' })
    expect(a[a.indexOf('-f') + 1]).not.toContain('height<=')
  })
  it('audio: the original file, or converted to MP3 at the best quality', () => {
    expect(buildDownloadArgs({ ...base, media: { kind: 'audio', format: 'original' } })).not.toContain('-x')
    const mp3 = buildDownloadArgs({ ...base, media: { kind: 'audio', format: 'mp3' }, ffmpegPath: 'x' })
    expect(mp3).toContain('-x')
    expect(mp3[mp3.indexOf('--audio-format') + 1]).toBe('mp3')
  })
  it('is a list of arguments: a hostile title or link cannot become a command or an option', () => {
    const a = buildDownloadArgs({ ...base, media: { kind: 'video', height: 0 }, headers: { Cookie: 'a=b; c=d' } })
    expect(a[a.indexOf('-o') + 1]).toBe('My 50%% video; rm -rf.%(ext)s') // % is doubled so yt-dlp does not read it as a template
    expect(a[a.indexOf('--add-header') + 1]).toBe('Cookie:a=b; c=d')
    expect(a.at(-2)).toBe('--')
    expect(a.at(-1)).toBe('https://example.com/v')
    expect(a.filter((x) => x === '--').length).toBe(1)
  })
})

describe('reading yt-dlp output', () => {
  it('progress lines, with missing values', () => {
    expect(parseProgress('GDM 1024 2048 NA 500.5')).toEqual({ downloaded: 1024, total: 2048, speed: 500.5 })
    expect(parseProgress('GDM 10 NA 4096 NA')).toEqual({ downloaded: 10, total: 4096, speed: null })
    expect(parseProgress('[download] 50% of 10MiB')).toBeNull()
  })
  it('where the finished file went', () => {
    expect(parseDestination('[Merger] Merging formats into "C:\\o\\a.mp4"')).toEqual({ path: 'C:\\o\\a.mp4', final: true })
    expect(parseDestination('[ExtractAudio] Destination: C:\\o\\a.mp3')).toEqual({ path: 'C:\\o\\a.mp3', final: true })
    expect(parseDestination('[download] Destination: a.f137.mp4')).toEqual({ path: 'a.f137.mp4', final: false })
    expect(parseDestination('[download] a.mp4 has already been downloaded')).toEqual({ path: 'a.mp4', final: true })
    expect(parseDestination('nothing')).toBeNull()
  })
  it('complaints in plain words', () => {
    expect(friendlyMediaError('ERROR: Unsupported URL: https://x')).toBe('No video was found on this page.')
    expect(friendlyMediaError('ERROR: Video unavailable. This video has been removed')).toBe('This video is not available.')
    expect(friendlyMediaError('ERROR: [x] This video is DRM protected')).toBe('This video is protected (DRM) and cannot be downloaded.')
    expect(friendlyMediaError('HTTP Error 429: Too Many Requests')).toBe('The site is limiting requests. Try again later.')
    expect(friendlyMediaError('urlopen error getaddrinfo failed')).toBe('Could not reach the server.')
    expect(friendlyMediaError('something strange')).toBe('The video could not be downloaded.')
  })
})

describe('downloading a video through the manager', () => {
  it('a ready-made 720p file: no helper needed, bytes intact', async () => {
    const { m, out } = mk()
    const id = await m.addMedia('https://example.com/watch?v=ok', { title: 'Clip: one', media: { kind: 'video', height: 720, needsFfmpeg: false, size: 2000000 } })
    expect(m.get(id).file_name).toBe('Clip_ one.mp4')
    await waitFor(() => m.get(id).status === 'completed')
    const d = m.get(id)
    expect(fs.readFileSync(d.save_path).equals(pattern(0, 2000000))).toBe(true)
    expect(path.dirname(d.save_path)).toBe(out)
    expect(d.size_bytes).toBe(2000000)
    expect(d.downloaded_bytes).toBe(2000000)
  })
  it('1080p with the helper: picture and sound fetched separately, joined, progress never goes back', async () => {
    const { m } = mk({ ffmpeg: true })
    const seen = []
    m.on('change', () => { const d = Object.values(m.store.data.downloads)[0]; if (d) seen.push(d.downloaded_bytes) })
    const id = await m.addMedia('https://example.com/watch?v=ok', { title: 'Big', media: { kind: 'video', height: 1080, needsFfmpeg: true, size: 2000000 } })
    await waitFor(() => m.get(id).status === 'completed')
    expect(fs.statSync(m.get(id).save_path).size).toBe(2000000) // 1.5 MB picture + 0.5 MB sound
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    expect(seen.some((n) => n > 1500000)).toBe(true) // it went on into the second stream
  })
  it('audio only: the original file, and MP3', async () => {
    const { m } = mk({ ffmpeg: true })
    const a = await m.addMedia('https://example.com/watch?v=ok', { title: 'Song', media: { kind: 'audio', format: 'original', size: 600000 } })
    const b = await m.addMedia('https://example.com/watch?v=ok', { title: 'Song', media: { kind: 'audio', format: 'mp3', needsFfmpeg: true, size: 600000 } })
    await waitFor(() => m.get(a).status === 'completed' && m.get(b).status === 'completed')
    expect(path.extname(m.get(a).save_path)).toBe('.m4a')
    expect(path.extname(m.get(b).save_path)).toBe('.mp3')
    expect(m.get(a).save_path).not.toBe(m.get(b).save_path)
  })
  it('pause stops the helper and resume carries on from the half-finished file', async () => {
    process.env.FAKE_YTDLP_DELAY = '60'
    const { m, out } = mk()
    const id = await m.addMedia('https://example.com/watch?v=ok', { title: 'Slow', media: { kind: 'video', height: 720, size: 2000000 } })
    await waitFor(() => m.get(id).downloaded_bytes > 300000)
    m.pause(id)
    expect(m.get(id).status).toBe('paused')
    await new Promise((r) => setTimeout(r, 400))
    const half = m.get(id).downloaded_bytes
    expect(fs.readdirSync(out).some((f) => f.endsWith('.part'))).toBe(true) // the half-finished file stays
    delete process.env.FAKE_YTDLP_DELAY
    m.resume(id)
    await waitFor(() => m.get(id).status === 'completed')
    expect(fs.readFileSync(m.get(id).save_path).equals(pattern(0, 2000000))).toBe(true) // continued, not restarted wrongly
    expect(half).toBeLessThan(2000000)
  })
  it('cancel removes the half-finished pieces', async () => {
    process.env.FAKE_YTDLP_DELAY = '60'
    const { m, out } = mk()
    const id = await m.addMedia('https://example.com/watch?v=ok', { title: 'Gone', media: { kind: 'video', height: 720, size: 2000000 } })
    await waitFor(() => m.get(id).downloaded_bytes > 200000)
    m.cancel(id)
    await new Promise((r) => setTimeout(r, 1200))
    delete process.env.FAKE_YTDLP_DELAY
    expect(m.get(id).status).toBe('cancelled')
    expect(fs.existsSync(out) ? fs.readdirSync(out) : []).toEqual([])
  })
  it('a failure comes back as a sentence', async () => {
    const { m } = mk()
    const id = await m.addMedia('https://example.com/fail-after', { title: 'Nope', media: { kind: 'video', height: 720 } })
    await waitFor(() => m.get(id).status === 'failed')
    expect(m.get(id).error).toBe('This video is not available.') // an HTTP 403 from the site
  })
  it('refuses anything but http(s) and unknown kinds', async () => {
    const { m } = mk()
    await expect(m.addMedia('file:///c:/x', { media: { kind: 'video' } })).rejects.toThrow()
    await expect(m.addMedia('https://example.com/x', { media: { kind: 'exe' } })).rejects.toThrow('not allowed')
  })
})

describe('getting the helper programs (checked against the published checksum)', () => {
  let server, base, serve
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const body = serve[req.url]
      if (!body) { res.writeHead(404); return res.end() }
      res.writeHead(200, { 'Content-Length': body.length })
      res.end(body)
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(() => server.close())
  const ytPath = '/yt-dlp/yt-dlp/releases/latest/download/'

  it('installs when the file matches its checksum', async () => {
    const exe = crypto.randomBytes(5000)
    serve = { [ytPath + 'yt-dlp.exe']: exe, [ytPath + 'SHA2-256SUMS']: Buffer.from(`${sha(Buffer.from('other'))}  yt-dlp\n${sha(exe)} *yt-dlp.exe\n`) }
    const tools = new Tools({ dir: fs.mkdtempSync(path.join(tmp, 't-')), base, script: '' })
    expect(tools.ytdlpCommand()).toBeNull()
    const steps = []
    await tools.ensureYtdlp((p) => steps.push(p))
    expect(fs.readFileSync(tools.ytdlpFile()).equals(exe)).toBe(true)
    expect(tools.ytdlpCommand().cmd).toBe(tools.ytdlpFile())
    expect(steps.at(-1)).toBe(100)
  })
  it('throws the file away when the checksum differs', async () => {
    serve = { [ytPath + 'yt-dlp.exe']: crypto.randomBytes(3000), [ytPath + 'SHA2-256SUMS']: Buffer.from(`${'0'.repeat(64)}  yt-dlp.exe\n`) }
    const tools = new Tools({ dir: fs.mkdtempSync(path.join(tmp, 't-')), base, script: '' })
    await expect(tools.ensureYtdlp()).rejects.toThrow('checksum')
    expect(fs.existsSync(tools.ytdlpFile())).toBe(false)
    expect(fs.readdirSync(tools.dir)).toEqual([]) // no half file left behind
  })
  it('refuses a download that has no published checksum', async () => {
    serve = { [ytPath + 'yt-dlp.exe']: crypto.randomBytes(3000), [ytPath + 'SHA2-256SUMS']: Buffer.from(`${'a'.repeat(64)}  something-else.exe\n`) }
    const tools = new Tools({ dir: fs.mkdtempSync(path.join(tmp, 't-')), base, script: '' })
    await expect(tools.ensureYtdlp()).rejects.toThrow('verify')
    expect(fs.existsSync(tools.ytdlpFile())).toBe(false)
  })
  it('unpacks only ffmpeg from the zip', async () => {
    // a small zip (stored, no compression) with ffmpeg.exe and another file inside a folder
    const entry = (name, data) => {
      const n = Buffer.from(name)
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(zlib.crc32(data), 14)
      h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26)
      return { local: Buffer.concat([h, n, data]), name: n, data }
    }
    const files = [entry('ffmpeg-x/bin/ffmpeg.exe', Buffer.from('FFMPEG-BINARY')), entry('ffmpeg-x/bin/ffprobe.exe', Buffer.from('PROBE')), entry('ffmpeg-x/LICENSE.txt', Buffer.from('lic'))]
    let offset = 0
    const central = files.map((f) => {
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6)
      c.writeUInt32LE(zlib.crc32(f.data), 16); c.writeUInt32LE(f.data.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(f.name.length, 28); c.writeUInt32LE(offset, 42)
      offset += f.local.length
      return Buffer.concat([c, f.name])
    })
    const dir = Buffer.concat(central)
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
    const zip = Buffer.concat([...files.map((f) => f.local), dir, end])
    const fp = '/yt-dlp/FFmpeg-Builds/releases/latest/download/'
    serve = { [fp + 'ffmpeg-master-latest-win64-lgpl.zip']: zip, [fp + 'checksums.sha256']: Buffer.from(`${sha(zip)}  ffmpeg-master-latest-win64-lgpl.zip\n`) }
    const tools = new Tools({ dir: fs.mkdtempSync(path.join(tmp, 't-')), base, script: '' })
    await tools.ensureFfmpeg()
    expect(fs.readFileSync(tools.ffmpegPath(), 'utf8')).toBe('FFMPEG-BINARY')
    expect(fs.readdirSync(tools.dir).sort()).toEqual(['ffmpeg.exe', 'ffmpeg.json']) // nothing else kept, and a note of which build it is
    expect(JSON.parse(fs.readFileSync(path.join(tools.dir, 'ffmpeg.json'), 'utf8')).zipSha).toBe(sha(zip))
  })
})
