import { test, expect, chromium, _electron as electron } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const EXT = path.resolve('extension')
const CHROME = path.resolve('.chromium/chrome.exe')
const TOKEN = 'e2e-token'
const FILE = crypto.randomBytes(3 * 1024 * 1024)
let server, base, tmp, out, app, win, ctx, sw, seenCookies

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'sid=abc123; Path=/' })
      return res.end('<a id=dl href="/file.bin">get</a>')
    }
    if (req.url === '/video') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end('<video src="/clip.mp4" autoplay muted></video>')
    }
    const isFile = req.url === '/file.bin'
    if (!isFile && req.url !== '/clip.mp4') { res.writeHead(404); return res.end() }
    if (isFile) seenCookies.push(req.headers.cookie || '')
    const start = m ? Number(m[1]) : 0
    const end = m && m[2] ? Number(m[2]) : FILE.length - 1
    res.writeHead(m ? 206 : 200, {
      'Content-Type': isFile ? 'application/octet-stream' : 'video/mp4',
      ...(isFile && { 'Content-Disposition': 'attachment; filename="report.bin"' }),
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      ...(m && { 'Content-Range': `bytes ${start}-${end}/${FILE.length}` }),
    })
    res.end(FILE.subarray(start, end + 1))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
test.afterAll(() => server.close())

async function boot(token = TOKEN) {
  seenCookies = []
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-ext-'))
  out = path.join(tmp, 'out')
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  // seeded so captured files land in the temp folder and the bridge token is known
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: TOKEN, download_dir: out, capture_prompt: false, show_toasts: false, progress_window: false, auto_pair: false } }))
  app = await electron.launch({ args: ['.'], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
  win = await app.firstWindow()
  // these tests are about the manual Connect and wrong-token cases, so the app asks (and the stub says no) instead of accepting by itself
  await app.evaluate(({ dialog }) => { globalThis.__prompts = []; dialog.showMessageBox = async (_w, o) => { globalThis.__prompts.push(o); return { response: 1 } } })
  ctx = await chromium.launchPersistentContext(path.join(tmp, 'chrome'), {
    ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : { channel: 'chromium' }), // a copy in .chromium works where the default location is blocked
    headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
  // the add-on tries to connect as soon as it is installed; let that attempt end (the stub refuses) before the test sets its own token
  await expect.poll(() => sw.evaluate(() => chrome.storage.local.get('pairDeniedAt').then((v) => v.pairDeniedAt || 0))).toBeGreaterThan(0)
  await sw.evaluate((t) => chrome.storage.local.set({ token: t, port: 17689, enabled: true }), token)
}

test.afterEach(async () => {
  await ctx?.close().catch(() => {})
  const p = app.process()
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
})

test('F02-H2 a browser download is taken over by the app, with cookies, and the browser copy is dropped', async () => {
  await boot()
  const page = await ctx.newPage()
  await page.goto(base + '/page')
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/file.bin'; a.download = ''; a.click() })
  const row = win.getByRole('row', { name: /report\.bin/ })
  await expect(row).toContainText('Done', { timeout: 20000 })
  expect(fs.readFileSync(path.join(out, 'report.bin')).equals(FILE)).toBe(true)
  expect(seenCookies.some((c) => c.includes('sid=abc123'))).toBe(true) // login cookie was forwarded
  const left = await sw.evaluate(() => chrome.downloads.search({}))
  expect(left).toHaveLength(0) // the browser's own copy was erased
})

test('F02-N3 with a wrong token the browser keeps its download and the app stays empty', async () => {
  await boot('wrong')
  const page = await ctx.newPage()
  await page.goto(base + '/page')
  const dl = page.waitForEvent('download')
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/file.bin'; a.download = ''; a.click() })
  await dl // the browser downloaded it itself
  await expect(win.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()
})

test('F03-H1 page media is detected and sent to the app from the popup path', async () => {
  await boot()
  const page = await ctx.newPage()
  await page.goto(base + '/video')
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, base + '/video')
  const id = sw.url().split('/')[2]
  const popup = await ctx.newPage()
  await popup.goto(`chrome-extension://${id}/popup.html`)
  await expect.poll(() => popup.evaluate((t) => chrome.runtime.sendMessage({ type: 'media', tabId: t }), tabId).then((r) => r.items.map((i) => i.url)), { timeout: 15000 }).toContain(base + '/clip.mp4')
  const r = await popup.evaluate((u) => chrome.runtime.sendMessage({ type: 'grab', url: u, referer: 'x' }), base + '/clip.mp4')
  expect(r.ok).toBe(true)
  await expect(win.getByRole('row', { name: /clip\.mp4/ })).toContainText('Done', { timeout: 20000 })
})

const answerPrompt = (response) => app.evaluate(({ dialog }, r) => {
  globalThis.__prompts = []
  dialog.showMessageBox = async (_w, o) => { globalThis.__prompts.push(o); return { response: r } }
}, response)

async function openPopup() {
  const id = sw.url().split('/')[2]
  const popup = await ctx.newPage()
  await popup.goto(`chrome-extension://${id}/popup.html`)
  return popup
}

test('popup offers Connect when the token is wrong and says what to do', async () => {
  await boot('wrong')
  const popup = await openPopup()
  await expect(popup.getByRole('status')).toContainText('Could not connect by itself')
  await expect(popup.getByRole('button', { name: 'Connect to GDM' })).toBeVisible()
})

test('F02-H3 one click pairs: Allow in the app, then downloads are captured with no copy and paste', async () => {
  await boot('wrong')
  await answerPrompt(0)
  const popup = await openPopup()
  await popup.getByRole('button', { name: 'Connect to GDM' }).click()
  await expect(popup.getByRole('status')).toContainText('Connected')
  await expect(popup.getByRole('button', { name: 'Connect to GDM' })).toBeHidden()
  const prompts = await app.evaluate(() => globalThis.__prompts)
  expect(prompts).toHaveLength(1)
  expect(prompts[0].detail).toContain('chrome-extension://') // the prompt names who is asking
  // and the capture now works
  const page = await ctx.newPage()
  await page.goto(base + '/page')
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/file.bin'; a.download = ''; a.click() })
  await expect(win.getByRole('row', { name: /report\.bin/ })).toContainText('Done', { timeout: 20000 })
})

test('F02-N4 Deny in the app: no token is given and the popup says so', async () => {
  await boot('wrong')
  await answerPrompt(1)
  const popup = await openPopup()
  await popup.getByRole('button', { name: 'Connect to GDM' }).click()
  await expect(popup.getByRole('status')).toContainText('not allowed')
  const stored = await sw.evaluate(() => chrome.storage.local.get('token'))
  expect(stored.token).toBe('wrong')
})
