import { test, expect, chromium, _electron as electron } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const EXT = path.resolve('extension')
const CHROME = path.resolve('.chromium/chrome.exe')
const TOKEN = 'prog-token'
const SIZE = 14 * 1024 * 1024
const FILE = crypto.randomBytes(SIZE)
let server, base, tmp, out, app, ctx, sw

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<p>page</p>') }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    const start = m ? Number(m[1]) : 0
    const end = m && m[2] ? Number(m[2]) : SIZE - 1
    res.writeHead(m ? 206 : 200, {
      'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="movie.bin"',
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      ...(m && { 'Content-Range': `bytes ${start}-${end}/${SIZE}` }),
    })
    let pos = start
    const pump = () => {
      if (res.destroyed) return
      if (pos > end) return res.end()
      const n = Math.min(24 * 1024, end - pos + 1) // about 0.8 MB/s per connection
      res.write(FILE.subarray(pos, pos + n)); pos += n
      setTimeout(pump, 30)
    }
    pump()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
test.afterAll(() => server.close())

async function boot(settings = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-prog-'))
  out = path.join(tmp, 'out')
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: TOKEN, download_dir: out, max_connections: 2, show_toasts: true, ...settings } }))
  app = await electron.launch({ args: ['.'], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
  await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close())) // main window closed: only the tray remains
  ctx = await chromium.launchPersistentContext(path.join(tmp, 'chrome'), {
    ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : { channel: 'chromium' }),
    headless: true, acceptDownloads: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
  await sw.evaluate((t) => chrome.storage.local.set({ token: t, port: 17689, enabled: true }), TOKEN)
}

test.afterEach(async () => {
  await ctx?.close().catch(() => {})
  const p = app.process()
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
})

const windowWith = async (part, timeout = 20000) => {
  const t = Date.now()
  for (;;) {
    const w = app.windows().find((x) => x.url().includes(part) && !x.isClosed())
    if (w) return w
    if (Date.now() - t > timeout) throw new Error(`no ${part} window`)
    await new Promise((r) => setTimeout(r, 100))
  }
}
const press = (page, name) => page.getByRole('button', { name, exact: true }).click().catch((e) => { if (!page.isClosed()) throw e })
const mainWindows = () => app.windows().filter((w) => w.url().includes('index.html') && !w.isClosed())

async function startFromBrowser() {
  const page = await ctx.newPage()
  await page.goto(base + '/page')
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/movie.bin'; a.download = ''; a.click() })
  await press(await windowWith('prompt.html'), 'Download')
  return windowWith('progress.html')
}
const mbps = (text) => { const m = /([\d.]+)\s*(KB|MB)\/s/.exec(text); return m ? Number(m[1]) * (m[2] === 'MB' ? 1024 : 1) : null }

test('P1 a download from the browser opens a progress window, not the main window', async () => {
  await boot()
  const pw = await startFromBrowser()
  await expect(pw.getByRole('heading', { name: 'movie.bin' })).toBeVisible()
  await expect(pw.getByRole('status')).toContainText('Downloading')
  await expect(pw.getByText(/(KB|MB)\/s/)).toBeVisible({ timeout: 8000 })
  await expect(pw.getByText(/^⁦?\d+ (s|min)/)).toBeVisible({ timeout: 8000 }) // time left
  await expect(pw.getByText('127.0.0.1')).toBeVisible()
  await expect(pw.getByText(path.join(out, 'movie.bin'))).toBeVisible()
  expect(mainWindows()).toHaveLength(0) // the main window stayed away
  await expect(pw.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^\d+$/)
})

test('P2 the numbers and the bar move smoothly', async () => {
  await boot()
  const pw = await startFromBrowser()
  await expect(pw.getByText(/(KB|MB)\/s/)).toBeVisible({ timeout: 8000 })
  const samples = []
  const t0 = Date.now()
  while (Date.now() - t0 < 3000) {
    samples.push(await pw.evaluate(() => ({
      t: performance.now(),
      bar: Number(/scaleX\(([\d.e-]+)\)/.exec(document.querySelector('.pbar i').style.transform)?.[1] ?? 0),
      speed: document.body.innerText.match(/([\d.]+)\s*(KB|MB)\/s/)?.[0] ?? '',
    })))
    await new Promise((r) => setTimeout(r, 50))
  }
  const bars = samples.map((s) => s.bar)
  for (let i = 1; i < bars.length; i++) expect(bars[i]).toBeGreaterThanOrEqual(bars[i - 1]) // never jumps back
  const changes = samples.filter((s, i) => i && s.bar !== samples[i - 1].bar)
  expect(changes.length).toBeGreaterThanOrEqual(10) // about five updates a second over three seconds
  let worstGap = 0
  for (let i = 1; i < changes.length; i++) worstGap = Math.max(worstGap, changes[i].t - changes[i - 1].t)
  expect(worstGap).toBeLessThan(500) // no stall longer than half a second
  const speeds = samples.map((s) => mbps(s.speed)).filter((v) => v != null).slice(-20)
  expect(Math.max(...speeds) / Math.min(...speeds)).toBeLessThan(1.6) // speed does not flicker up and down
})

test('P3 Pause and Resume in the window', async () => {
  await boot()
  const pw = await startFromBrowser()
  await expect(pw.getByText(/(KB|MB)\/s/)).toBeVisible({ timeout: 8000 })
  await press(pw, 'Pause')
  await expect(pw.getByRole('status')).toContainText('Paused')
  await expect(pw.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
  await press(pw, 'Resume')
  await expect(pw.getByRole('status')).toContainText('Downloading')
})

test('P4 Hide closes the window but the download carries on to the end', async () => {
  await boot()
  const pw = await startFromBrowser()
  await expect(pw.getByText(/(KB|MB)\/s/)).toBeVisible({ timeout: 8000 })
  await press(pw, 'Hide')
  await expect.poll(() => pw.isClosed()).toBe(true)
  await expect.poll(() => fs.existsSync(path.join(out, 'movie.bin')), { timeout: 40000 }).toBe(true)
  expect(fs.readFileSync(path.join(out, 'movie.bin')).equals(FILE)).toBe(true)
})

test('P5 when it finishes the progress window closes and the finished notice opens', async () => {
  await boot({ max_connections: 8 })
  const pw = await startFromBrowser()
  const toast = await windowWith('toast.html', 40000)
  await expect(toast.getByRole('heading', { name: 'Download finished' })).toBeVisible()
  expect(pw.isClosed()).toBe(true)
  expect(mainWindows()).toHaveLength(0)
})

test('P6 Cancel download stops it and removes the file', async () => {
  await boot()
  const pw = await startFromBrowser()
  await expect(pw.getByText(/(KB|MB)\/s/)).toBeVisible({ timeout: 8000 })
  await press(pw, 'Cancel download')
  await expect.poll(() => pw.isClosed()).toBe(true)
  await new Promise((r) => setTimeout(r, 800))
  expect(fs.existsSync(path.join(out, 'movie.bin'))).toBe(false)
})

test('P7 with the setting off, no progress window opens', async () => {
  await boot({ progress_window: false, max_connections: 8 })
  const page = await ctx.newPage()
  await page.goto(base + '/page')
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/movie.bin'; a.download = ''; a.click() })
  await press(await windowWith('prompt.html'), 'Download')
  await new Promise((r) => setTimeout(r, 1500))
  expect(app.windows().filter((w) => w.url().includes('progress.html'))).toHaveLength(0)
})

test('P8 the progress window has no accessibility violations, in light and in dark', async () => {
  const axe = (await import('axe-core')).default
  await boot()
  const pw = await startFromBrowser()
  await expect(pw.getByText(/(KB|MB)\/s/)).toBeVisible({ timeout: 8000 })
  await pw.emulateMedia({ colorScheme: null })
  for (const theme of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t }, theme)
    await expect.poll(() => pw.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark')
    await new Promise((r) => setTimeout(r, 500)) // buttons fade between themes for 120 ms; scanning mid-fade sees in-between colours
    await pw.evaluate(axe.source)
    const v = await pw.evaluate(() => window.axe.run().then((r) => r.violations.map((x) => `${x.id}: ${x.nodes[0].html.slice(0, 70)}`)))
    expect(v, theme).toEqual([])
  }
})
