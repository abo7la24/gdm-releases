import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Updater, isNewer, parseVersion, checkAddress, sha256File } = require('../main/updater.cjs')
const { Tools } = require('../main/tools.cjs')

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
let tmp, server, base, routes
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)) } }

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-upd-'))
  server = http.createServer((req, res) => {
    const r = routes[req.url]
    if (!r) { res.writeHead(404); return res.end() }
    const body = Buffer.isBuffer(r) ? r : Buffer.from(typeof r === 'string' ? r : JSON.stringify(r))
    res.writeHead(200, { 'Content-Length': body.length })
    res.end(body)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) })

const installer = crypto.randomBytes(200000)
const feed = (over = {}) => ({ version: '0.2.0', url: '/setup-0.2.0.exe', sha256: sha(installer), notes: { en: 'Faster', fr: 'Plus rapide' }, ...over })
const mk = (over = {}) => new Updater({ current: '0.1.0', dir: fs.mkdtempSync(path.join(tmp, 'u-')), feedUrl: () => `${base}/latest.json`, ...over })
beforeEach(() => { routes = { '/latest.json': feed(), '/setup-0.2.0.exe': installer } })

describe('versions', () => {
  it('compares numbers, not text', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('1.10.0', '1.9.0')).toBe(true)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.0.9', '0.1.0')).toBe(false)
    expect(isNewer('v2.0.0-beta', '1.9.9')).toBe(true)
    expect(isNewer('nonsense', '0.1.0')).toBe(false)
    expect(parseVersion('x')).toBeNull()
  })
})

describe('the update address', () => {
  it('accepts https and this computer, refuses everything else', () => {
    expect(() => checkAddress('https://example.com/latest.json')).not.toThrow()
    expect(() => checkAddress('http://127.0.0.1:9/latest.json')).not.toThrow()
    for (const bad of ['http://example.com/latest.json', 'ftp://example.com/x', 'file:///c:/x.json', 'javascript:alert(1)', 'not a url', '']) {
      expect(() => checkAddress(bad), bad).toThrow('https://')
    }
  })
})

describe('checking and fetching an update', () => {
  it('finds a newer version, fetches it, verifies it, and says it is ready', async () => {
    const u = mk()
    const seen = []
    u.on('change', (s) => seen.push(s.status))
    await u.check()
    expect(u.state).toMatchObject({ status: 'ready', version: '0.2.0', progress: 100, notes: { en: 'Faster', fr: 'Plus rapide' } })
    expect(seen).toEqual(expect.arrayContaining(['checking', 'available', 'downloading', 'ready']))
    expect(fs.readFileSync(u.state.file).equals(installer)).toBe(true)
  })
  it('says there is nothing new when the version is the same or older', async () => {
    routes['/latest.json'] = feed({ version: '0.1.0' })
    const u = mk()
    await u.check()
    expect(u.state.status).toBe('none')
    expect(fs.readdirSync(u.dir)).toEqual([])
  })
  it('throws a download away when its checksum does not match, and keeps no half file', async () => {
    routes['/latest.json'] = feed({ sha256: '0'.repeat(64) })
    const u = mk()
    await u.check()
    expect(u.state).toMatchObject({ status: 'error', error: 'The download did not match its checksum, so it was not used.' })
    expect(fs.readdirSync(u.dir)).toEqual([])
  })
  it('refuses an update file that is not valid', async () => {
    for (const bad of ['not json', {}, feed({ version: 'abc' }), feed({ sha256: 'short' }), feed({ url: 5 })]) {
      routes['/latest.json'] = bad
      const u = mk()
      await u.check()
      expect(u.state.error, JSON.stringify(bad)).toBe('The update file is not valid.')
    }
  })
  it('refuses an installer on a plain http address from another computer', async () => {
    routes['/latest.json'] = feed({ url: 'http://example.com/setup.exe' })
    const u = mk()
    await u.check()
    expect(u.state.error).toBe('The update address must start with https://.')
  })
  it('reports a missing feed, a missing setting and a missing installer in plain words', async () => {
    let u = mk({ feedUrl: () => '' })
    await u.check()
    expect(u.state.error).toBe('Updates are not set up yet. Enter the address of the update file.')
    delete routes['/latest.json']
    u = mk()
    await u.check()
    expect(u.state.error).toBe('Could not check for updates.')
    routes['/latest.json'] = feed()
    delete routes['/setup-0.2.0.exe']
    u = mk()
    await u.check()
    expect(u.state.error).toBe('Could not download the update.')
    u = mk({ feedUrl: () => 'http://127.0.0.1:1/latest.json' }) // nobody listens
    await u.check()
    expect(u.state.status).toBe('error')
  })
  it('does not fetch the installer again when a good copy is already there', async () => {
    const u = mk()
    await u.check()
    let fetched = 0
    const orig = routes['/setup-0.2.0.exe']
    routes['/setup-0.2.0.exe'] = undefined
    const again = new Updater({ current: '0.1.0', dir: u.dir, feedUrl: () => `${base}/latest.json` })
    again.on('change', (s) => { if (s.status === 'downloading') fetched++ })
    await again.check()
    expect(again.state.status).toBe('ready')
    expect(fetched).toBe(0)
    routes['/setup-0.2.0.exe'] = orig
  })
})

describe('installing', () => {
  it('starts the checked installer silently, and starts GDM again afterwards', async () => {
    const u = mk()
    await u.check()
    const calls = []
    expect(await u.installIfReady((f, a) => calls.push([f, a]))).toBe(true)
    expect(calls).toEqual([[u.state.file, ['/S', '--updated', '--force-run']]])
  })
  it('does nothing when no update is ready', async () => {
    const u = mk()
    const calls = []
    expect(await u.installIfReady((f, a) => calls.push([f, a]))).toBe(false)
    expect(calls).toEqual([])
  })
  it('checks the file once more and refuses it if it was changed after the download', async () => {
    const u = mk()
    await u.check()
    fs.appendFileSync(u.state.file, 'tampered')
    const calls = []
    expect(await u.installIfReady((f, a) => calls.push([f, a]))).toBe(false)
    expect(calls).toEqual([])
  })
  it('never starts a file from outside its own folder', async () => {
    const u = mk()
    await u.check()
    u.state.file = path.join(tmp, 'elsewhere.exe')
    fs.writeFileSync(u.state.file, installer)
    const calls = []
    expect(await u.installIfReady((f, a) => calls.push([f, a]))).toBe(false)
  })
})

describe('keeping the download helpers current', () => {
  const ytPath = '/yt-dlp/yt-dlp/releases/latest/download/'
  const ffPath = '/yt-dlp/FFmpeg-Builds/releases/latest/download/'
  const newExe = crypto.randomBytes(4000)
  const oldExe = crypto.randomBytes(4000)
  const tools = () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'h-'))
    return new Tools({ dir, base, script: '' })
  }

  it('leaves yt-dlp alone when it matches the published checksum', async () => {
    const t = tools()
    fs.writeFileSync(t.ytdlpFile(), newExe)
    routes = { [ytPath + 'SHA2-256SUMS']: `${sha(newExe)}  yt-dlp.exe\n` }
    expect(await t.updateHelpers({ ffmpeg: false })).toMatchObject({ ytdlp: 'current' })
    expect(fs.readFileSync(t.ytdlpFile()).equals(newExe)).toBe(true)
  })
  it('replaces yt-dlp by the checked new file when the published checksum is different', async () => {
    const t = tools()
    fs.writeFileSync(t.ytdlpFile(), oldExe)
    routes = { [ytPath + 'yt-dlp.exe']: newExe, [ytPath + 'SHA2-256SUMS']: `${sha(newExe)}  yt-dlp.exe\n` }
    expect((await t.updateHelpers({ ffmpeg: false })).ytdlp).toBe('updated')
    expect(fs.readFileSync(t.ytdlpFile()).equals(newExe)).toBe(true)
    expect(fs.readdirSync(t.dir)).toEqual(['yt-dlp.exe'])
  })
  it('keeps the old yt-dlp when the new file does not match its checksum', async () => {
    const t = tools()
    fs.writeFileSync(t.ytdlpFile(), oldExe)
    routes = { [ytPath + 'yt-dlp.exe']: crypto.randomBytes(4000), [ytPath + 'SHA2-256SUMS']: `${sha(newExe)}  yt-dlp.exe\n` }
    await expect(t.updateHelpers({ ffmpeg: false })).rejects.toThrow('checksum')
    expect(fs.readFileSync(t.ytdlpFile()).equals(oldExe)).toBe(true)
  })
  it('does not touch a helper that is in use right now', async () => {
    const t = tools()
    fs.writeFileSync(t.ytdlpFile(), oldExe)
    routes = { [ytPath + 'SHA2-256SUMS']: `${sha(newExe)}  yt-dlp.exe\n` }
    expect((await t.updateHelpers({ ffmpeg: false, busy: true })).ytdlp).toBe('busy')
    expect(fs.readFileSync(t.ytdlpFile()).equals(oldExe)).toBe(true)
  })
  it('does not install a helper that was never installed (updates only keep existing ones current)', async () => {
    const t = tools()
    routes = { [ytPath + 'SHA2-256SUMS']: `${sha(newExe)}  yt-dlp.exe\n`, [ffPath + 'checksums.sha256']: `${'a'.repeat(64)}  ffmpeg-master-latest-win64-lgpl.zip\n` }
    expect(await t.updateHelpers()).toEqual({ ytdlp: 'missing', ffmpeg: 'missing' })
  })
  it('recognises the conversion helper as current by the build it was unpacked from', async () => {
    const t = tools()
    fs.writeFileSync(t.ffmpegFile(), 'ffmpeg')
    fs.writeFileSync(path.join(t.dir, 'ffmpeg.json'), JSON.stringify({ zipSha: 'b'.repeat(64) }))
    routes = { [ffPath + 'checksums.sha256']: `${'b'.repeat(64)}  ffmpeg-master-latest-win64-lgpl.zip\n` }
    expect((await t.updateHelpers()).ffmpeg).toBe('current')
    routes = { [ffPath + 'checksums.sha256']: `${'c'.repeat(64)}  ffmpeg-master-latest-win64-lgpl.zip\n` }
    expect((await t.updateHelpers({ busy: true })).ffmpeg).toBe('busy') // newer build exists, left for later
    expect(fs.existsSync(t.ffmpegFile())).toBe(true)
  })
  it('the file hash helper agrees with the standard hash', async () => {
    const f = path.join(tmp, 'h.bin')
    fs.writeFileSync(f, installer)
    expect(await sha256File(f)).toBe(sha(installer))
  })
})
