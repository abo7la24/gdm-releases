import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Manager } = require('../main/engine.cjs')
const { Store } = require('../main/store.cjs')
const { startBridge } = require('../main/bridge.cjs')

let files, bridge, base, dir, m
let answer = true
const asked = []
const call = (p, { method = 'GET', headers = {}, body } = {}) =>
  fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) })
const ok = { 'x-gdm-token': 'secret' }

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-br-'))
  files = http.createServer((req, res) => {
    const r = /bytes=(\d+)-/.exec(req.headers.range || '')
    res.writeHead(r ? 206 : 200, { 'Content-Length': r ? 1 : 5, ...(r && { 'Content-Range': 'bytes 0-0/5' }) })
    res.end(r ? 'h' : 'hello')
  })
  await new Promise((r) => files.listen(0, '127.0.0.1', r))
  m = new Manager(new Store(path.join(dir, 's.json')), {
    download_dir: path.join(dir, 'out'), temp_dir: path.join(dir, 'tmp'), max_connections: 2, max_parallel: 2,
    speed_limit_kbps: 0, capture_enabled: true, capture_skip_ext: 'png,jpg', token: 'secret',
  })
  bridge = startBridge(m, { port: 0, pair: async (origin) => { asked.push(origin); return answer } })
  await new Promise((r) => bridge.on('listening', r))
  base = `http://127.0.0.1:${bridge.address().port}`
})
afterAll(() => { bridge.close(); files.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('bridge with the new-download window', () => {
  let b2, base2, choice, calls
  beforeAll(async () => {
    calls = []
    const m2 = new Manager(new Store(path.join(dir, 's2.json')), {
      download_dir: path.join(dir, 'out2'), temp_dir: path.join(dir, 'tmp2'), max_connections: 2, max_parallel: 2,
      speed_limit_kbps: 0, capture_enabled: true, capture_prompt: true, capture_skip_ext: 'png', token: 'secret',
    })
    b2 = startBridge(m2, { port: 0, review: async (x) => { calls.push(x); return choice } })
    await new Promise((r) => b2.on('listening', r))
    base2 = `http://127.0.0.1:${b2.address().port}`
  })
  afterAll(() => b2.close())
  const cap = (url) => fetch(base2 + '/v1/capture', { method: 'POST', headers: { 'content-type': 'application/json', ...ok }, body: JSON.stringify({ url, referer: 'r', cookies: 'a=b' }) }).then((r) => r.json())

  it('asks the window instead of adding straight away, passing cookies and referrer along', async () => {
    choice = { ok: true, id: 'x1' }
    const r = await cap('http://127.0.0.1:1/a.bin')
    expect(r).toEqual({ ok: true, id: 'x1' })
    expect(calls.at(-1).headers).toEqual({ Referer: 'r', Cookie: 'a=b' })
  })
  it('passes cancel and leave-to-browser answers back to the extension', async () => {
    choice = { ok: true, cancelled: true }
    expect(await cap('http://127.0.0.1:1/b.bin')).toEqual({ ok: true, cancelled: true })
    choice = { ok: false, reason: 'left to the browser' }
    expect((await cap('http://127.0.0.1:1/c.bin')).ok).toBe(false)
  })
  it('skipped file types never reach the window', async () => {
    const before = calls.length
    expect((await cap('http://127.0.0.1:1/p.png')).ok).toBe(false)
    expect(calls).toHaveLength(before)
  })
})

describe('bridge', () => {
  it('rejects a missing or wrong token', async () => {
    expect((await call('/v1/status')).status).toBe(401)
    expect((await call('/v1/status', { headers: { 'x-gdm-token': 'nope' } })).status).toBe(401)
  })
  it('rejects requests that come from a web page origin, even with the token', async () => {
    const r = await call('/v1/status', { headers: { ...ok, Origin: 'https://evil.example' } })
    expect(r.status).toBe(403)
  })
  it('accepts the token and an extension origin', async () => {
    const r = await call('/v1/status', { headers: { ...ok, Origin: 'chrome-extension://abc' } })
    expect(r.status).toBe(200)
    expect((await r.json()).capture).toBe(true)
  })
  it('captures a link once even if sent twice', async () => {
    const url = `http://127.0.0.1:${files.address().port}/a.txt`
    const a = await (await call('/v1/capture', { method: 'POST', headers: ok, body: { url } })).json()
    const b = await (await call('/v1/capture', { method: 'POST', headers: ok, body: { url } })).json()
    expect(a.id).toBe(b.id)
    expect(m.list()).toHaveLength(1)
  })
  it('leaves skipped file types to the browser', async () => {
    const before = m.list().length
    const r = await (await call('/v1/capture', { method: 'POST', headers: ok, body: { url: `http://127.0.0.1:${files.address().port}/photo.PNG` } })).json()
    expect(r.ok).toBe(false)
    expect(m.list()).toHaveLength(before)
  })
  it('pairing hands the token to an extension only after the app says yes', async () => {
    answer = true
    const r = await call('/v1/pair', { method: 'POST', headers: { Origin: 'chrome-extension://abc' } })
    expect(r.status).toBe(200)
    expect((await r.json()).token).toBe('secret')
    expect(asked).toEqual(['chrome-extension://abc'])
  })
  it('pairing is refused when the user denies', async () => {
    answer = false
    const r = await call('/v1/pair', { method: 'POST', headers: { Origin: 'chrome-extension://abc' } })
    expect(r.status).toBe(403)
    expect(JSON.stringify(await r.json())).not.toContain('secret')
  })
  it('pairing is refused for web pages and for callers with no origin, without asking', async () => {
    answer = true
    const before = asked.length
    expect((await call('/v1/pair', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status).toBe(403)
    expect((await call('/v1/pair', { method: 'POST' })).status).toBe(403)
    expect(asked).toHaveLength(before)
  })
  it('only one pairing prompt at a time', async () => {
    let release
    answer = new Promise((r) => { release = r })
    const first = call('/v1/pair', { method: 'POST', headers: { Origin: 'chrome-extension://abc' } })
    await new Promise((r) => setTimeout(r, 100))
    const second = await call('/v1/pair', { method: 'POST', headers: { Origin: 'chrome-extension://def' } })
    expect(second.status).toBe(429)
    release(false)
    expect((await first).status).toBe(403)
    answer = true
  })
  it('refuses non-http links', async () => {
    const r = await call('/v1/capture', { method: 'POST', headers: ok, body: { url: 'file:///c:/secret' } })
    expect(r.status).toBe(502)
  })
})
