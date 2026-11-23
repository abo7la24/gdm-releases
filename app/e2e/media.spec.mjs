import { test, expect, chromium, _electron as electron } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FAKE = path.resolve('test/fake-ytdlp.cjs')
const EXT = path.resolve('extension')
const CHROME = path.resolve('.chromium/chrome.exe')
const TOKEN = 'media-token'
let tmp, out, log, app, win, ctx

async function boot(settings = {}, env = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-media-'))
  out = path.join(tmp, 'out')
  log = path.join(tmp, 'ytdlp.log')
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'tools'))
  fs.writeFileSync(path.join(tmp, 'tools', 'ffmpeg.exe'), 'placeholder') // the conversion helper counts as installed
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: TOKEN, download_dir: out, show_toasts: false, ...settings } }))
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data'), GDM_YTDLP_SCRIPT: FAKE, GDM_TOOLS_DIR: path.join(tmp, 'tools'), FAKE_YTDLP_LOG: log, ...env },
  })
  win = await app.firstWindow()
}

test.afterEach(async () => {
  await ctx?.close().catch(() => {})
  ctx = undefined
  const p = app?.process()
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  if (p && p.exitCode === null) await new Promise((r) => p.once('exit', r))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
})

const windowWith = async (part, timeout = 20000) => {
  const t0 = Date.now()
  for (;;) {
    const w = app.windows().find((x) => x.url().includes(part) && !x.isClosed())
    if (w) return w
    if (Date.now() - t0 > timeout) throw new Error(`no ${part} window`)
    await new Promise((r) => setTimeout(r, 100))
  }
}
const press = (page, name) => page.getByRole('button', { name, exact: true }).click().catch((e) => { if (!page.isClosed()) throw e })
const requestVideo = (url, extra = {}) => fetch('http://127.0.0.1:17689/v1/media', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gdm-token': TOKEN }, body: JSON.stringify({ url, ...extra }) }).then((r) => r.json())
const openPrompt = async (url) => {
  expect((await requestVideo(url)).ok).toBe(true)
  const prompt = await windowWith('prompt.html')
  await expect(prompt.getByRole('heading', { name: 'Video or audio from this page' })).toBeVisible()
  return prompt
}
const downloadLog = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.mode === 'download')
const selectorOf = (entry) => entry.args[entry.args.indexOf('-f') + 1]

test('V1 a page with a video opens a window listing every quality', async () => {
  await boot()
  const prompt = await openPrompt('https://example.com/watch?v=ok')
  await expect(prompt.getByLabel('File name')).toHaveValue('Sample_ the video _ part 2', { timeout: 15000 })
  await expect(prompt.getByText('Some Channel')).toBeVisible()
  const options = await prompt.getByLabel('Quality').locator('option').allTextContents()
  expect(options[0]).toBe('Best available (1080p 60 fps)')
  expect(options.some((o) => /^720p · MP4 · about 11\.4 MB$/.test(o))).toBe(true)
  expect(options.some((o) => /^360p/.test(o))).toBe(true)
  await expect(prompt.getByRole('radio', { name: 'Video' })).toBeChecked()
})

test('V2 choose 720p: it downloads, a progress window shows it, the file is right, and the choice is remembered', async () => {
  await boot()
  const prompt = await openPrompt('https://example.com/watch?v=ok')
  await expect(prompt.getByLabel('Quality')).toBeVisible()
  await prompt.getByLabel('Quality').selectOption('720')
  await press(prompt, 'Download')
  const progress = await windowWith('progress.html')
  await expect(progress.getByRole('heading', { name: 'Sample_ the video _ part 2.mp4' })).toBeVisible()
  await expect.poll(() => fs.existsSync(out) && fs.readdirSync(out).includes('Sample_ the video _ part 2.mp4'), { timeout: 20000 }).toBe(true)
  expect(fs.statSync(path.join(out, 'Sample_ the video _ part 2.mp4')).size).toBe(2000000)
  expect(selectorOf(downloadLog().at(-1))).toContain('[height<=720]')
  // the next time, 720p is already chosen
  const again = await openPrompt('https://example.com/watch?v=ok')
  await expect(again.getByLabel('Quality')).toHaveValue('720', { timeout: 15000 })
})

test('V3 audio only: the original file, or MP3', async () => {
  await boot()
  const prompt = await openPrompt('https://example.com/watch?v=ok')
  await prompt.getByRole('radio', { name: 'Audio only' }).check()
  const options = await prompt.getByLabel('Quality').locator('option').allTextContents()
  expect(options[0]).toMatch(/^Original quality \(M4A\)/)
  expect(options[1]).toMatch(/^MP3 \(converted\)/)
  await prompt.getByLabel('Quality').selectOption('mp3')
  await press(prompt, 'Download')
  await expect.poll(() => fs.existsSync(out) && fs.readdirSync(out).some((f) => f.endsWith('.mp3')), { timeout: 20000 }).toBe(true)
  const args = downloadLog().at(-1).args
  expect(args).toContain('-x')
  expect(args[args.indexOf('--audio-format') + 1]).toBe('mp3')
})

test('V4 a page without a video says so, and nothing can be downloaded', async () => {
  await boot()
  const prompt = await openPrompt('https://example.com/unsupported')
  await expect(prompt.getByRole('alert')).toContainText('No video was found on this page.')
  await expect(prompt.getByRole('button', { name: 'Download', exact: true })).toBeDisabled()
})

test('V5 a video that needs a login explains what to do', async () => {
  await boot()
  const prompt = await openPrompt('https://example.com/private')
  await expect(prompt.getByRole('alert')).toContainText('signed in')
})

test('V6 the Add dialog has a Video or audio button for a page link', async () => {
  await boot()
  await win.getByRole('button', { name: 'Add link' }).first().click()
  const dlg = win.getByRole('dialog', { name: 'Add download' })
  await dlg.getByLabel('Link').fill('https://example.com/watch?v=ok')
  await dlg.getByRole('button', { name: 'Video or audio…' }).click()
  const prompt = await windowWith('prompt.html')
  await expect(prompt.getByLabel('Quality')).toBeVisible({ timeout: 15000 })
  await prompt.getByLabel('Quality').selectOption('360')
  await press(prompt, 'Download')
  await expect(win.getByRole('row', { name: /Sample_ the video _ part 2/ })).toContainText('Done', { timeout: 20000 })
  expect(app.windows().filter((w) => w.url().includes('progress.html'))).toHaveLength(0) // started from the main window: no extra window
})

test('V7 the progress window shows the icon of the kind of file, not the program logo', async () => {
  await boot()
  const prompt = await openPrompt('https://example.com/watch?v=ok')
  await expect(prompt.getByLabel('Quality')).toBeVisible()
  await expect(prompt.locator('.fileicon img[src^="data:image/png"]')).toHaveCount(1) // the prompt too
  await press(prompt, 'Download')
  const progress = await windowWith('progress.html')
  const icon = progress.locator('.fileicon img')
  await expect(icon).toHaveAttribute('src', /^data:image\/png;base64,/)
  expect(await icon.evaluate((i) => i.naturalWidth)).toBeGreaterThan(0)
  expect(await progress.locator('img[src*="logo.png"]').count()).toBe(0)
})

test('V8 the choice window follows the chosen language and reads right to left in Arabic', async () => {
  await boot({ language: 'ar' })
  const prompt = await openPrompt2('https://example.com/watch?v=ok')
  await expect(prompt.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(prompt.getByRole('radio', { name: 'الصوت فقط' })).toBeVisible({ timeout: 15000 })
  await expect(prompt.getByLabel('الجودة')).toBeVisible()
})
async function openPrompt2(url) {
  expect((await requestVideo(url)).ok).toBe(true)
  return windowWith('prompt.html')
}

test('V9 the browser add-on sends a page (with the browser session) and the window opens', async () => {
  await boot()
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'sid=abc123; Path=/' }); res.end('<video></video>') })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'chrome'), {
      ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : { channel: 'chromium' }),
      headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    })
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'))
    await expect.poll(() => sw.evaluate(() => chrome.storage.local.get('token').then((v) => v.token)), { timeout: 15000 }).toBe(TOKEN) // connected by itself
    const base = `http://127.0.0.1:${server.address().port}`
    const page = await ctx.newPage()
    await page.goto(base + '/watch')
    const popup = await ctx.newPage()
    await popup.goto(`chrome-extension://${sw.url().split('/')[2]}/popup.html`)
    await expect(popup.getByRole('button', { name: 'Download video or audio from this page' })).toBeVisible()
    const r = await popup.evaluate((u) => chrome.runtime.sendMessage({ type: 'video', url: u, referer: u }), base + '/watch')
    expect(r.ok).toBe(true)
    const prompt = await windowWith('prompt.html')
    await expect(prompt.getByLabel('Quality')).toBeVisible({ timeout: 15000 })
    const probe = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.mode === 'probe')
    expect(probe.args).toContain('Cookie:sid=abc123') // the logged-in session travels with the request
    expect(probe.args).toContain(`Referer:${base}/watch`)
  } finally {
    server.close()
  }
})
