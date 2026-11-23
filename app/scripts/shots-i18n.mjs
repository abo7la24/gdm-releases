// Screenshots of the main window, the video choice window and the progress window in Arabic, French and English.
// Uses the stand-in for yt-dlp, so it needs no internet. Usage: node scripts/shots-i18n.mjs <output folder>
import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const outDir = path.resolve(process.argv[2] || '../replica/clone-screens')
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const lang of ['ar', 'fr', 'en']) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-shots-'))
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'tools'))
  fs.writeFileSync(path.join(tmp, 'tools', 'ffmpeg.exe'), 'x')
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: 'sh', download_dir: path.join(tmp, 'out'), language: lang, show_toasts: false } }))
  const app = await electron.launch({
    args: ['.'], colorScheme: null,
    env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data'), GDM_YTDLP_SCRIPT: path.resolve('test/fake-ytdlp.cjs'), GDM_TOOLS_DIR: path.join(tmp, 'tools'), FAKE_YTDLP_DELAY: '120' },
  })
  const main = await app.firstWindow()
  const find = async (part) => { for (let i = 0; i < 200; i++) { const w = app.windows().find((x) => x.url().includes(part) && !x.isClosed()); if (w) return w; await sleep(100) } throw new Error('no ' + part) }
  await sleep(800)
  fetch('http://127.0.0.1:17689/v1/media', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gdm-token': 'sh' }, body: JSON.stringify({ url: 'https://example.com/watch?v=ok' }) }).catch(() => {})
  const prompt = await find('prompt.html')
  await prompt.getByLabel(/./).first().waitFor({ timeout: 15000 }).catch(() => {})
  await sleep(1200)
  await prompt.screenshot({ path: path.join(outDir, `video-choice-${lang}.png`) })
  await prompt.locator('select').selectOption('720').catch(() => {})
  await prompt.locator('button[type=submit]').click().catch(() => {})
  const prog = await find('progress.html')
  await sleep(1800)
  await prog.screenshot({ path: path.join(outDir, `progress-${lang}.png`) })
  await main.screenshot({ path: path.join(outDir, `main-${lang}.png`) })
  const p = app.process()
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
}
console.log('shots in', outDir)
