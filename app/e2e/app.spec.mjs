import { test, expect, _electron as electron } from '@playwright/test'
import axe from 'axe-core'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const SIZE = 8 * 1024 * 1024
const DATA = crypto.randomBytes(SIZE)
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
let server, base, tmp, app, win, errors

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/missing')) { res.writeHead(404); return res.end() }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    const start = m ? Number(m[1]) : 0
    const end = m && m[2] ? Number(m[2]) : SIZE - 1
    res.writeHead(m ? 206 : 200, {
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ETag: '"e2e"',
      ...(m && { 'Content-Range': `bytes ${start}-${end}/${SIZE}` }),
    })
    let pos = start
    const pump = () => {
      if (res.destroyed) return
      if (pos > end) return res.end()
      const n = Math.min(64 * 1024, end - pos + 1)
      res.write(DATA.subarray(pos, pos + n))
      pos += n
      setTimeout(pump, 25)
    }
    pump()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
test.afterAll(() => server.close())

async function quit() {
  const p = app.process()
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
}

test.beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-e2e-'))
  app = await electron.launch({ args: ['.'], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
  win = await app.firstWindow()
  errors = []
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  win.on('pageerror', (e) => errors.push(String(e)))
  await expect(win.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()
})
test.afterEach(async () => {
  expect(errors, 'console errors').toEqual([])
  await quit()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp dir, os cleans it */ }
})

async function add(urlPath, { name } = {}) {
  await win.getByRole('button', { name: 'Add link' }).first().click()
  const dlg = win.getByRole('dialog', { name: 'Add download' })
  await dlg.getByLabel('Link').fill(base + urlPath)
  await dlg.getByLabel('Save to').fill(path.join(tmp, 'out'))
  if (name) await dlg.getByLabel(/File name/).fill(name)
  await dlg.getByRole('button', { name: 'Start download' }).click()
  return dlg
}

test('F01-H1 add a link, it finishes, bytes match', async () => {
  await add('/big.bin')
  await expect(win.getByRole('row', { name: /big\.bin/ })).toBeVisible()
  await expect(win.getByRole('row', { name: /big\.bin/ })).toContainText('Done', { timeout: 30000 })
  expect(sha(fs.readFileSync(path.join(tmp, 'out', 'big.bin')))).toBe(sha(DATA))
  await expect(win.getByRole('button', { name: /^Done\s*1$/ })).toBeVisible()
})

test('F01-N1 a link that is not http shows an inline error and adds nothing', async () => {
  await win.getByRole('button', { name: 'Add link' }).first().click()
  const dlg = win.getByRole('dialog', { name: 'Add download' })
  await dlg.getByLabel('Link').fill('ftp://example.com/x')
  await dlg.getByRole('button', { name: 'Start download' }).click()
  await expect(dlg.getByRole('alert')).toContainText('http')
  await expect(dlg).toBeVisible()
})

test('F01-N2 a 404 link shows the server error in the dialog', async () => {
  const dlg = await add('/missing.bin')
  await expect(dlg.getByRole('alert')).toContainText('404')
})

test('F01-E1 custom name with spaces, accents and emoji is kept', async () => {
  await add('/big.bin', { name: 'café 🎉 report.bin' })
  await expect(win.getByRole('row', { name: /café 🎉 report\.bin/ })).toContainText('Done', { timeout: 30000 })
  expect(fs.existsSync(path.join(tmp, 'out', 'café 🎉 report.bin'))).toBe(true)
})

test('F01-E2 same link twice gets a (1) suffix, no overwrite', async () => {
  await add('/big.bin')
  await expect(win.getByRole('row', { name: /big\.bin/ })).toBeVisible()
  await add('/big.bin')
  await expect(win.getByRole('row')).toHaveCount(3) // header + 2
  await expect(win.getByRole('row', { name: /big \(1\)\.bin/ })).toBeVisible()
})

test('F04-H1 pause then resume finishes with correct bytes', async () => {
  await add('/big.bin')
  const row = win.getByRole('row', { name: /big\.bin/ })
  await expect(row).toContainText('Downloading')
  await row.click()
  await win.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(row).toContainText('Paused')
  await win.getByRole('button', { name: 'Resume' }).click()
  await expect(row).toContainText('Done', { timeout: 30000 })
  expect(sha(fs.readFileSync(path.join(tmp, 'out', 'big.bin')))).toBe(sha(DATA))
})

test('F04-E1 cancel keeps a row marked cancelled and leaves no file', async () => {
  await add('/big.bin')
  const row = win.getByRole('row', { name: /big\.bin/ })
  await row.dblclick()
  const dlg = win.getByRole('dialog', { name: 'Download details' })
  await dlg.getByRole('button', { name: 'Cancel download' }).click()
  await dlg.getByRole('button', { name: 'Close' }).click()
  await expect(row).toContainText('Cancelled')
  expect(fs.existsSync(path.join(tmp, 'out', 'big.bin'))).toBe(false)
})

test('F01-E3 keyboard only: open dialog, type link, Enter', async () => {
  await win.getByRole('button', { name: 'Add link' }).first().focus()
  await win.keyboard.press('Enter')
  const dlg = win.getByRole('dialog', { name: 'Add download' })
  await expect(dlg.getByLabel('Link')).toBeFocused() // focus lands in the field
  await dlg.getByLabel('Save to').fill(path.join(tmp, 'out'))
  await dlg.getByLabel('Link').fill(base + '/big.bin')
  await win.keyboard.press('Enter')
  await expect(win.getByRole('row', { name: /big\.bin/ })).toBeVisible()
  await win.getByRole('row', { name: /big\.bin/ }).focus()
  await win.keyboard.press('Enter')
  await expect(win.getByRole('dialog', { name: 'Download details' })).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(win.getByRole('dialog')).toHaveCount(0)
})

test('F05-H1 settings persist across reopening', async () => {
  await win.getByRole('button', { name: 'Settings' }).click()
  const dlg = win.getByRole('dialog', { name: 'Settings' })
  await dlg.getByRole('tab', { name: 'Connections' }).click()
  await dlg.getByLabel('Connections per download').fill('4')
  await dlg.getByRole('button', { name: 'Save' }).click()
  await win.getByRole('button', { name: 'Settings' }).click()
  await win.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Connections' }).click()
  await expect(win.getByLabel('Connections per download')).toHaveValue('4')
})

test('F05-N1 an out-of-range setting is refused with a message', async () => {
  await win.getByRole('button', { name: 'Settings' }).click()
  const dlg = win.getByRole('dialog', { name: 'Settings' })
  await dlg.getByRole('tab', { name: 'Connections' }).click()
  await dlg.getByLabel('Connections per download').fill('99')
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(win.getByRole('alert')).toContainText('not allowed')
})

// AxeBuilder opens a second page, which Electron does not allow: inject axe-core directly.
async function scan() {
  await win.evaluate(axe.source)
  const r = await win.evaluate(() => window.axe.run())
  return r.violations.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 80)}`)
}

test('A11Y main window and add dialog have no axe violations', async () => {
  expect(await scan()).toEqual([])
  await win.getByRole('button', { name: 'Add link' }).first().click()
  expect(await scan()).toEqual([])
})

test('F01-E4 restart keeps a paused download in the list', async () => {
  await add('/big.bin')
  const row = win.getByRole('row', { name: /big\.bin/ })
  await expect(row).toContainText('Downloading')
  await row.click()
  await win.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(row).toContainText('Paused')
  // a hard kill (not a clean quit) must still find the state on disk shortly after the change
  const file = path.join(tmp, 'data', 'gdm.json')
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('"status":"paused"')
  await quit()
  app = await electron.launch({ args: ['.'], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
  win = await app.firstWindow()
  errors = []
  await expect(win.getByRole('row', { name: /big\.bin/ })).toContainText('Paused')
})
