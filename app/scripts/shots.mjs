// Takes screenshots of the main window, the progress window and the setup dialog in light and dark.
// Usage: node scripts/shots.mjs <output folder>
import { _electron as electron } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const outDir = path.resolve(process.argv[2] || '../docs/screens')
fs.mkdirSync(outDir, { recursive: true })
const SIZE = 40 * 1024 * 1024
const server = http.createServer((req, res) => {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
  const start = m ? Number(m[1]) : 0
  const end = m && m[2] ? Number(m[2]) : SIZE - 1
  res.writeHead(m ? 206 : 200, { 'Content-Disposition': 'attachment; filename="holiday-video-2026.mp4"', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m && { 'Content-Range': `bytes ${start}-${end}/${SIZE}` }) })
  let pos = start
  const pump = () => { if (res.destroyed) return; if (pos > end) return res.end(); const n = Math.min(32 * 1024, end - pos + 1); res.write(Buffer.alloc(n, 7)); pos += n; setTimeout(pump, 25) }
  pump()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-shots-'))
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: 'sh', download_dir: path.join(tmp, 'out'), max_connections: 4 } }))
const app = await electron.launch({ args: ['.'], colorScheme: null, env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
const main = await app.firstWindow()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const find = async (part) => { for (let i = 0; i < 200; i++) { const w = app.windows().find((x) => x.url().includes(part) && !x.isClosed()); if (w) return w; await sleep(100) } throw new Error('no ' + part) }
const theme = (t) => app.evaluate(({ nativeTheme }, v) => { nativeTheme.themeSource = v }, t)

for (const t of ['light', 'dark']) {
  await theme(t)
  await sleep(300)
  await main.screenshot({ path: path.join(outDir, `main-${t}-empty.png`) })
}
fetch('http://127.0.0.1:17689/v1/capture', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gdm-token': 'sh' }, body: JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/video` }) }).catch(() => {})
const prompt = await find('prompt.html')
await sleep(500)
await prompt.screenshot({ path: path.join(outDir, 'prompt-dark.png') })
await prompt.getByRole('button', { name: 'Download', exact: true }).click().catch(() => {})
const prog = await find('progress.html')
await sleep(3500)
for (const t of ['dark', 'light']) {
  await theme(t)
  await sleep(500)
  await prog.screenshot({ path: path.join(outDir, `progress-${t}.png`) })
}
await theme('dark')
await sleep(300)
await main.screenshot({ path: path.join(outDir, 'main-dark-filled.png') })
await main.getByRole('toolbar').getByRole('button', { name: 'Add to browser' }).click()
await main.getByRole('tab', { name: 'Firefox' }).click()
await sleep(300)
await main.screenshot({ path: path.join(outDir, 'setup-firefox-dark.png') })
const p = app.process()
await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
server.close()
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
console.log('shots in', outDir)
