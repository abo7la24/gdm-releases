import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Manager, planSegments, sanitize, checkUrl, friendly } = require('../main/engine.cjs')
const { Store } = require('../main/store.cjs')

const DATA = crypto.randomBytes(6 * 1024 * 1024)
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
let server, base, rangeRequests, tmp

function serve(req, res) {
  const slow = req.url.startsWith('/slow')
  const ranges = !req.url.includes('norange')
  let start = 0
  let end = DATA.length - 1
  let status = 200
  const h = { 'Content-Type': 'application/octet-stream', ETag: '"v1"' }
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
  if (ranges) h['Accept-Ranges'] = 'bytes'
  if (m && ranges) {
    rangeRequests++
    start = Number(m[1])
    end = m[2] ? Number(m[2]) : end
    status = 206
    h['Content-Range'] = `bytes ${start}-${end}/${DATA.length}`
  }
  h['Content-Length'] = end - start + 1
  res.writeHead(status, h)
  let pos = start
  const chunk = slow ? 32 * 1024 : 256 * 1024
  const pump = () => {
    if (res.destroyed) return
    if (pos > end) return res.end()
    const next = Math.min(pos + chunk, end + 1)
    res.write(DATA.subarray(pos, next))
    pos = next
    slow ? setTimeout(pump, 20) : setImmediate(pump)
  }
  pump()
}

function mk(dir, extra = {}) {
  const store = new Store(path.join(dir, 'state.json'))
  const m = new Manager(store, {
    download_dir: path.join(dir, 'out'), temp_dir: path.join(dir, 'tmp'),
    max_connections: 4, max_parallel: 3, speed_limit_kbps: 0, ...extra,
  })
  return { store, m }
}

const waitFor = async (fn, ms = 15000) => {
  const t = Date.now()
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-'))
  server = http.createServer(serve)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }) })

describe('helpers', () => {
  it('splits into contiguous segments covering the file', () => {
    const segs = planSegments(10 * 1024 * 1024 + 7, true, 4)
    expect(segs).toHaveLength(4)
    expect(segs[0].start).toBe(0)
    expect(segs[3].end).toBe(10 * 1024 * 1024 + 6)
    for (let i = 1; i < 4; i++) expect(segs[i].start).toBe(segs[i - 1].end + 1)
  })
  it('uses one segment when ranges are unsupported or the file is small', () => {
    expect(planSegments(100, true, 8)).toHaveLength(1)
    expect(planSegments(50 * 1024 * 1024, false, 8)).toHaveLength(1)
  })
  it('sanitises Windows-hostile names and rejects non-http links', () => {
    expect(sanitize('a:b*c?.txt')).toBe('a_b_c_.txt')
    expect(sanitize('CON.txt')).toBe('_CON.txt')
    expect(() => checkUrl('file:///c:/x')).toThrow()
    expect(() => checkUrl('nonsense')).toThrow()
  })
})

describe('plain-words errors', () => {
  it('turns network and disk codes into sentences', () => {
    expect(friendly(Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }))).toMatch(/address/)
    expect(friendly(new Error('terminated'))).toMatch(/cut/)
    expect(friendly(Object.assign(new Error('x'), { code: 'ENOSPC' }))).toBe('The disk is full.')
    expect(friendly(new Error('The server replied 404.'))).toBe('The server replied 404.')
  })
})

describe('engine', () => {
  it('downloads with several connections and the bytes match', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'a-'))
    const { m } = mk(dir)
    rangeRequests = 0
    const id = await m.add(`${base}/file.bin`)
    await waitFor(() => m.get(id).status === 'completed')
    expect(sha(fs.readFileSync(m.get(id).save_path))).toBe(sha(DATA))
    expect(rangeRequests).toBeGreaterThan(4) // probe + 4 segments
  })

  it('falls back to one connection when the server has no ranges', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'b-'))
    const { m } = mk(dir)
    const id = await m.add(`${base}/norange.bin`)
    expect(m.get(id).resumable).toBe(false)
    await waitFor(() => m.get(id).status === 'completed')
    expect(sha(fs.readFileSync(m.get(id).save_path))).toBe(sha(DATA))
  })

  it('pauses, survives a restart as paused, then resumes to a correct file', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'c-'))
    const { store, m } = mk(dir)
    const id = await m.add(`${base}/slow.bin`)
    await waitFor(() => m.get(id).downloaded_bytes > 400 * 1024)
    m.pause(id)
    expect(m.get(id).status).toBe('paused')
    await new Promise((r) => setTimeout(r, 300))
    const partial = m.get(id).downloaded_bytes
    expect(partial).toBeLessThan(DATA.length)
    store.flush()
    const second = mk(dir) // simulates restarting the app
    expect(second.m.get(id).status).toBe('paused')
    second.m.resume(id)
    await waitFor(() => second.m.get(id).status === 'completed')
    expect(sha(fs.readFileSync(second.m.get(id).save_path))).toBe(sha(DATA))
  })

  it('keeps to the speed limit', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'f-'))
    const { m } = mk(dir, { speed_limit_kbps: 4096 }) // 6 MB at 4 MB/s should take about 1.5 s; unlimited takes ~0.1 s
    const t = Date.now()
    const id = await m.add(`${base}/limited.bin`)
    await waitFor(() => m.get(id).status === 'completed')
    expect(Date.now() - t).toBeGreaterThan(1100)
    expect(Date.now() - t).toBeLessThan(6000)
    expect(sha(fs.readFileSync(m.get(id).save_path))).toBe(sha(DATA))
  })

  it('names colliding files with a suffix', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'd-'))
    const { m } = mk(dir)
    const a = await m.add(`${base}/same.bin`)
    const b = await m.add(`${base}/same.bin`)
    expect(m.get(a).save_path).not.toBe(m.get(b).save_path)
    await waitFor(() => m.get(a).status === 'completed' && m.get(b).status === 'completed')
  })

  it('fails cleanly on a missing server', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'e-'))
    const { m } = mk(dir)
    await expect(m.add('http://127.0.0.1:1/x')).rejects.toBeTruthy()
  })
})
