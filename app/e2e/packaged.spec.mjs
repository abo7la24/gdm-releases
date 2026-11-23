import { test, expect, _electron as electron } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Runs the built app (release/win-unpacked), not the dev build. Skipped until `npm run dist` has been run.
const EXE = path.resolve('release/win-unpacked/Genius Download Manager.exe')
test.skip(!fs.existsSync(EXE), 'build the installer first (npm run dist)')

test('packaged app: a link opens the new-download window, and finishing opens the notice', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-pack-'))
  const out = path.join(tmp, 'out')
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: 'pk', download_dir: out } }))
  const server = http.createServer((req, res) => {
    const body = Buffer.from('hello')
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    const start = m ? Number(m[1]) : 0
    const end = m && m[2] ? Number(m[2]) : body.length - 1
    res.writeHead(m ? 206 : 200, { 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(m && { 'Content-Range': `bytes ${start}-${end}/${body.length}` }) })
    res.end(body.subarray(start, end + 1))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const app = await electron.launch({ executablePath: EXE, env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
  try {
    const win = await app.firstWindow()
    // the add-on travels with the installer, and the app puts a copy in a stable folder for the browser to load
    expect(fs.existsSync(path.join(path.dirname(EXE), 'resources', 'extension', 'manifest.json'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'extension', 'manifest.json'), 'utf8')).name).toContain('GDM')
    await expect(win.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()
    const url = `http://127.0.0.1:${server.address().port}/tiny.txt`
    const sent = fetch('http://127.0.0.1:17689/v1/capture', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-gdm-token': 'pk' }, body: JSON.stringify({ url }),
    }).then((r) => r.json())
    const find = async (part) => {
      for (let i = 0; i < 200; i++) {
        const w = app.windows().find((x) => x.url().includes(part) && !x.isClosed())
        if (w) return w
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error('no ' + part)
    }
    const prompt = await find('prompt.html')
    await expect(prompt.getByLabel('File name')).toHaveValue('tiny.txt')
    await prompt.getByRole('button', { name: 'Download', exact: true }).click().catch(() => {})
    expect((await sent).ok).toBe(true)
    const toast = await find('toast.html')
    await expect(toast.getByRole('heading', { name: 'Download finished' })).toBeVisible()
    expect(fs.readFileSync(path.join(out, 'tiny.txt'), 'utf8')).toBe('hello')
  } finally {
    const p = app.process()
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
    if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
    server.close()
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
  }
})
