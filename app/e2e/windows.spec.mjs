import { test, expect, chromium, _electron as electron } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const EXT = path.resolve('extension')
const CHROME = path.resolve('.chromium/chrome.exe')
const TOKEN = 'win-token'
const FILE = crypto.randomBytes(3 * 1024 * 1024)
let server, base, tmp, out, app, win, ctx, sw

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<p>page</p>') }
    const failing = req.url === '/fail.bin'
    if (!failing && req.url !== '/file.bin') { res.writeHead(404); return res.end() }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    const start = m ? Number(m[1]) : 0
    const end = m && m[2] ? Number(m[2]) : FILE.length - 1
    res.writeHead(m ? 206 : 200, {
      'Content-Type': 'application/octet-stream',
      ...(!failing && { 'Content-Disposition': 'attachment; filename="report.bin"' }),
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      ...(m && { 'Content-Range': `bytes ${start}-${end}/${FILE.length}` }),
    })
    // the failing file answers the probe, then drops every real connection half way
    if (failing && end - start > 1) { res.write(FILE.subarray(start, start + 1000)); return setTimeout(() => res.destroy(), 20) }
    res.end(FILE.subarray(start, end + 1))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
test.afterAll(() => server.close())

test.beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-win-'))
  out = path.join(tmp, 'out')
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  // defaults for the two windows are left on: that is what is under test
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: TOKEN, download_dir: out } }))
  app = await electron.launch({ args: ['.'], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
  win = await app.firstWindow()
  await app.evaluate(({ shell }) => {
    globalThis.__calls = []
    shell.openPath = async (p) => { globalThis.__calls.push(['openPath', p]); return '' }
    shell.showItemInFolder = (p) => { globalThis.__calls.push(['showItemInFolder', p]) }
  })
  ctx = await chromium.launchPersistentContext(path.join(tmp, 'chrome'), {
    ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : { channel: 'chromium' }),
    headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
  await sw.evaluate((t) => chrome.storage.local.set({ token: t, port: 17689, enabled: true }), TOKEN)
})

test.afterEach(async () => {
  await ctx?.close().catch(() => {})
  const p = app.process()
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
})

// pressing a button in these windows closes them, which Playwright reports as an error on the click itself
async function press(page, name) {
  await page.getByRole('button', { name, exact: true }).click().catch((e) => { if (!page.isClosed()) throw e })
}

async function windowWith(part, timeout = 20000) {
  const t = Date.now()
  for (;;) {
    const w = app.windows().find((x) => x.url().includes(part) && !x.isClosed())
    if (w) return w
    if (Date.now() - t > timeout) throw new Error(`no ${part} window`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function browserDownload(urlPath = '/file.bin') {
  const page = await ctx.newPage()
  await page.goto(base + '/page')
  await page.evaluate((u) => { const a = document.createElement('a'); a.href = u; a.download = ''; a.click() }, urlPath)
  return page
}

test('W1 a link from the browser opens its own window, and Download starts it', async () => {
  await browserDownload()
  const prompt = await windowWith('prompt.html')
  await expect(prompt.getByRole('heading', { name: 'New download' })).toBeVisible()
  await expect(prompt.getByLabel('File name')).toHaveValue('report.bin') // from the server, before any click
  await expect(prompt.getByText('127.0.0.1')).toBeVisible()
  await expect(prompt.getByText('3.0 MB')).toBeVisible()
  if (process.env.GDM_SHOTS) await prompt.screenshot({ path: path.join(process.env.GDM_SHOTS, 'prompt.png') }) // dev aid
  await press(prompt, 'Download')
  await expect(win.getByRole('row', { name: /report\.bin/ })).toContainText('Done', { timeout: 20000 })
  expect(fs.readFileSync(path.join(out, 'report.bin')).equals(FILE)).toBe(true)
  expect(await sw.evaluate(() => chrome.downloads.search({}))).toHaveLength(0) // browser copy erased
  expect(prompt.isClosed()).toBe(true)
})

test('W2 the user can rename the file and change the folder in that window', async () => {
  await browserDownload()
  const prompt = await windowWith('prompt.html')
  await prompt.getByLabel('File name').fill('my copy.bin')
  await prompt.getByLabel('Save to').fill(path.join(tmp, 'elsewhere'))
  await press(prompt, 'Download')
  await expect(win.getByRole('row', { name: /my copy\.bin/ })).toContainText('Done', { timeout: 20000 })
  expect(fs.existsSync(path.join(tmp, 'elsewhere', 'my copy.bin'))).toBe(true)
})

test('W3 "Let the browser do it" leaves the download with the browser and the app list empty', async () => {
  const page = await ctx.newPage()
  await page.goto(base + '/page')
  const dl = page.waitForEvent('download')
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/file.bin'; a.download = ''; a.click() })
  const prompt = await windowWith('prompt.html')
  await press(prompt, 'Let the browser do it')
  await dl
  await expect(win.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()
})

test('W4 Cancel drops the download everywhere', async () => {
  await browserDownload()
  const prompt = await windowWith('prompt.html')
  await press(prompt, 'Cancel')
  await expect.poll(() => sw.evaluate(() => chrome.downloads.search({}).then((l) => l.length))).toBe(0)
  await expect(win.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()
  expect(fs.existsSync(out) ? fs.readdirSync(out) : []).toEqual([])
})

test('W5 Escape leaves it to the browser', async () => {
  const page = await ctx.newPage()
  await page.goto(base + '/page')
  const dl = page.waitForEvent('download')
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/file.bin'; a.download = ''; a.click() })
  const prompt = await windowWith('prompt.html')
  await prompt.keyboard.press('Escape').catch((e) => { if (!prompt.isClosed()) throw e }) // the window closes on the key press
  await dl
  await expect(win.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()
})

test('W5b closing the window with the X leaves it to the browser too', async () => {
  const page = await ctx.newPage()
  await page.goto(base + '/page')
  const dl = page.waitForEvent('download')
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/file.bin'; a.download = ''; a.click() })
  await windowWith('prompt.html')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'New download')?.close())
  await dl
  await expect(win.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()
})

test('W6 a finished download opens a notice window; Show in folder works and closes it', async () => {
  await browserDownload()
  await press(await windowWith('prompt.html'), 'Download')
  const toast = await windowWith('toast.html')
  await expect(toast.getByRole('heading', { name: 'Download finished' })).toBeVisible()
  await expect(toast.getByText('report.bin')).toBeVisible()
  if (process.env.GDM_SHOTS) await toast.screenshot({ path: path.join(process.env.GDM_SHOTS, 'toast-finished.png') }) // dev aid
  await press(toast, 'Show in folder')
  await expect.poll(() => app.evaluate(() => globalThis.__calls)).toEqual([['showItemInFolder', path.join(out, 'report.bin')]])
  await expect.poll(() => toast.isClosed()).toBe(true)
})

test('W7 Open in the notice opens the file', async () => {
  await browserDownload()
  await press(await windowWith('prompt.html'), 'Download')
  const toast = await windowWith('toast.html')
  await press(toast, 'Open')
  await expect.poll(() => app.evaluate(() => globalThis.__calls)).toEqual([['openPath', path.join(out, 'report.bin')]])
})

test('W8 a failed download opens a notice with the reason and a Try again button', async () => {
  await win.getByRole('button', { name: 'Add link' }).first().click()
  const dlg = win.getByRole('dialog', { name: 'Add download' })
  await dlg.getByLabel('Link').fill(base + '/fail.bin')
  await dlg.getByLabel('Save to').fill(out)
  await dlg.getByRole('button', { name: 'Start download' }).click()
  const toast = await windowWith('toast.html', 30000)
  await expect(toast.getByRole('alert')).toContainText('Download failed')
  await expect(toast.getByText('fail.bin')).toBeVisible()
  if (process.env.GDM_SHOTS) await toast.screenshot({ path: path.join(process.env.GDM_SHOTS, 'toast-failed.png') }) // dev aid
  await press(toast, 'Try again')
  await expect(win.getByRole('row', { name: /fail\.bin/ })).not.toContainText('Failed')
  await expect.poll(() => toast.isClosed()).toBe(true)
})

test('W9 the notice windows have no accessibility violations', async () => {
  const axe = (await import('axe-core')).default
  await browserDownload()
  const prompt = await windowWith('prompt.html')
  await prompt.evaluate(axe.source)
  const v1 = await prompt.evaluate(() => window.axe.run().then((r) => r.violations.map((v) => v.id)))
  expect(v1).toEqual([])
  await press(prompt, 'Download')
  const toast = await windowWith('toast.html')
  await toast.evaluate(axe.source)
  const v2 = await toast.evaluate(() => window.axe.run().then((r) => r.violations.map((v) => v.id)))
  expect(v2).toEqual([])
})
