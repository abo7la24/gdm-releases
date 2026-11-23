import { test, expect, _electron as electron } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const SIZE = 6 * 1024 * 1024
const DATA = crypto.randomBytes(SIZE)

test('closing the window frees it but downloads carry on; opening again shows the result', async () => {
  const server = http.createServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    const start = m ? Number(m[1]) : 0
    const end = m && m[2] ? Number(m[2]) : SIZE - 1
    res.writeHead(m ? 206 : 200, { 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m && { 'Content-Range': `bytes ${start}-${end}/${SIZE}` }) })
    let pos = start
    const pump = () => {
      if (res.destroyed) return
      if (pos > end) return res.end()
      const n = Math.min(64 * 1024, end - pos + 1)
      res.write(DATA.subarray(pos, pos + n)); pos += n
      setTimeout(pump, 25)
    }
    pump()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-life-'))
  const out = path.join(tmp, 'out')
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: 't', download_dir: out, show_toasts: false } }))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
  try {
    const win = await app.firstWindow()
    await win.getByRole('button', { name: 'Add link' }).first().click()
    const dlg = win.getByRole('dialog', { name: 'Add download' })
    await dlg.getByLabel('Link').fill(`http://127.0.0.1:${server.address().port}/big.bin`)
    await dlg.getByRole('button', { name: 'Start download' }).click()
    await expect(win.getByRole('row', { name: /big\.bin/ })).toContainText('Downloading')

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close())) // close to the tray
    await expect.poll(() => app.windows().filter((w) => !w.isClosed()).length).toBe(0)

    await expect.poll(() => fs.existsSync(path.join(out, 'big.bin')), { timeout: 20000 }).toBe(true) // finished with no window open
    await app.evaluate(({ app: a }) => a.emit('second-instance')) // what starting the program again does
    const win2 = await app.waitForEvent('window')
    await expect(win2.getByRole('row', { name: /big\.bin/ })).toContainText('Done')
    expect(fs.readFileSync(path.join(out, 'big.bin')).equals(DATA)).toBe(true)
  } finally {
    const p = app.process()
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
    if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
    server.close()
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
  }
})
