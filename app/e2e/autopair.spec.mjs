import { test, expect, chromium, _electron as electron } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { extensionIdFromKey } = require('../main/trust.cjs')

const EXT = path.resolve('extension')
const CHROME = path.resolve('.chromium/chrome.exe')
const TOKEN = 'auto-token'
const FILE = crypto.randomBytes(2 * 1024 * 1024)
const OWN_ID = extensionIdFromKey(JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8')).key)
let server, base, tmp, out, app, ctx, sw

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<p>page</p>') }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    const start = m ? Number(m[1]) : 0
    const end = m && m[2] ? Number(m[2]) : FILE.length - 1
    res.writeHead(m ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="auto.bin"', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m && { 'Content-Range': `bytes ${start}-${end}/${FILE.length}` }) })
    res.end(FILE.subarray(start, end + 1))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
test.afterAll(() => server.close())

function seed(settings = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-auto-'))
  out = path.join(tmp, 'out')
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: TOKEN, download_dir: out, capture_prompt: false, progress_window: false, show_toasts: false, ...settings } }))
}
async function startApp() {
  app = await electron.launch({ args: ['.'], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
  const win = await app.firstWindow()
  // records every question the app would ask the user; the answer is no, so a question can never be mistaken for success
  await app.evaluate(({ dialog }) => { globalThis.__prompts = []; dialog.showMessageBox = async (_w, o) => { globalThis.__prompts.push(o); return { response: 1 } } })
  return win
}
async function startBrowser() {
  ctx = await chromium.launchPersistentContext(path.join(tmp, 'chrome'), {
    ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : { channel: 'chromium' }),
    headless: true, acceptDownloads: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
}
const stored = () => sw.evaluate(() => chrome.storage.local.get(['token', 'pairDeniedAt']))
const prompts = () => app.evaluate(() => globalThis.__prompts.length)
const download = async () => {
  const page = await ctx.newPage()
  await page.goto(base + '/page')
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/auto.bin'; a.download = ''; a.click() })
}

test.afterEach(async () => {
  await ctx?.close().catch(() => {})
  ctx = undefined
  const p = app?.process()
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  if (p && p.exitCode === null) await new Promise((r) => p.once('exit', r))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
})

test('A1 the add-on connects by itself the moment it is installed: no question, no click', async () => {
  seed()
  await startApp()
  await startBrowser()
  expect(new URL(sw.url()).host).toBe(OWN_ID) // the browser gives the add-on the id the app expects
  await expect.poll(async () => (await stored()).token, { timeout: 15000 }).toBe(TOKEN)
  expect(await prompts()).toBe(0)
})

test('A2 and the first download is captured with nothing pressed', async () => {
  seed()
  const win = await startApp()
  await startBrowser()
  await expect.poll(async () => (await stored()).token, { timeout: 15000 }).toBe(TOKEN)
  await download()
  await expect(win.getByRole('row', { name: /auto\.bin/ })).toContainText('Done', { timeout: 20000 })
  expect(fs.readFileSync(path.join(out, 'auto.bin')).equals(FILE)).toBe(true)
  expect(await prompts()).toBe(0)
})

test('A3 the browser started first, the app later: the first download still gets taken over', async () => {
  seed()
  await startBrowser() // app not running yet: the first attempt finds nobody
  await new Promise((r) => setTimeout(r, 1500))
  expect((await stored()).token ?? '').toBe('')
  const win = await startApp()
  await download()
  await expect(win.getByRole('row', { name: /auto\.bin/ })).toContainText('Done', { timeout: 20000 })
  expect((await stored()).token).toBe(TOKEN)
  expect(await prompts()).toBe(0)
})

test('A4 a token that went stale (new app data) is renewed by itself', async () => {
  seed()
  const win = await startApp()
  await startBrowser()
  await expect.poll(async () => (await stored()).token, { timeout: 15000 }).toBe(TOKEN)
  await sw.evaluate(() => chrome.storage.local.set({ token: 'old-and-wrong' }))
  await download()
  await expect(win.getByRole('row', { name: /auto\.bin/ })).toContainText('Done', { timeout: 20000 })
  expect((await stored()).token).toBe(TOKEN)
})

test('A5 with the setting off the app asks, and a refusal is remembered (no repeated questions)', async () => {
  seed({ auto_pair: false })
  await startApp()
  await startBrowser()
  await expect.poll(async () => (await stored()).pairDeniedAt || 0, { timeout: 15000 }).toBeGreaterThan(0)
  expect(await prompts()).toBe(1)
  expect((await stored()).token ?? '').toBe('')
  await download() // browser keeps its own download, and the app does not ask again
  await new Promise((r) => setTimeout(r, 1500))
  expect(await prompts()).toBe(1)
})

test('A6 an add-on the app does not know is always asked about, even with the setting on', async () => {
  seed()
  await startApp()
  const r = await fetch('http://127.0.0.1:17689/v1/pair', { method: 'POST', headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } })
  expect(r.status).toBe(403) // the stub said no
  expect(await prompts()).toBe(1)
  const own = await fetch('http://127.0.0.1:17689/v1/pair', { method: 'POST', headers: { Origin: `chrome-extension://${OWN_ID}` } })
  expect(own.status).toBe(200)
  expect((await own.json()).token).toBe(TOKEN)
  expect(await prompts()).toBe(1) // our own add-on added no question
  const web = await fetch('http://127.0.0.1:17689/v1/pair', { method: 'POST', headers: { Origin: 'https://evil.example' } })
  expect(web.status).toBe(403)
})
