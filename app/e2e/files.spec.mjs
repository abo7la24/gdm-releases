import { test, expect, _electron as electron } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let server, base, tmp, app, win, out

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': 11 })
    res.end('hello world')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
test.afterAll(() => server.close())

test.beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-files-'))
  out = path.join(tmp, 'out')
  app = await electron.launch({ args: ['.'], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
  win = await app.firstWindow()
  // Record what the app would hand to Windows instead of really opening Explorer or a program.
  await app.evaluate(({ shell }) => {
    globalThis.__calls = []
    shell.openPath = async (p) => { globalThis.__calls.push(['openPath', p]); return '' }
    shell.showItemInFolder = (p) => { globalThis.__calls.push(['showItemInFolder', p]) }
  })
  await win.getByRole('button', { name: 'Add link' }).first().click()
  const dlg = win.getByRole('dialog', { name: 'Add download' })
  await dlg.getByLabel('Link').fill(base + '/note.txt')
  await dlg.getByLabel('Save to').fill(out)
  await dlg.getByRole('button', { name: 'Start download' }).click()
  await expect(win.getByRole('row', { name: /note\.txt/ })).toContainText('Done')
})
test.afterEach(async () => {
  const p = app.process()
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
})

const calls = () => app.evaluate(() => globalThis.__calls)
const menuItem = async (name) => {
  await win.getByRole('row', { name: /note\.txt/ }).click({ button: 'right' })
  await win.getByRole('menuitem', { name }).click()
}

test('open file asks the OS to open the saved file', async () => {
  await menuItem('Open file')
  await expect.poll(calls).toEqual([['openPath', path.join(out, 'note.txt')]])
})

test('show in folder points at the saved file', async () => {
  await menuItem('Show in folder')
  await expect.poll(calls).toEqual([['showItemInFolder', path.join(out, 'note.txt')]])
})

test('open file when the file was deleted outside the app shows an error', async () => {
  fs.rmSync(path.join(out, 'note.txt'))
  await menuItem('Open file')
  await expect(win.getByRole('alert')).toContainText('not there any more')
})

test('remove from list keeps the file on disk', async () => {
  await menuItem('Remove…')
  await win.getByRole('dialog', { name: 'Remove download' }).getByRole('button', { name: 'Remove from list' }).click()
  await expect(win.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()
  expect(fs.existsSync(path.join(out, 'note.txt'))).toBe(true)
})

test('delete file too removes the row and the file', async () => {
  await menuItem('Remove…')
  await win.getByRole('dialog', { name: 'Remove download' }).getByRole('button', { name: 'Delete file too' }).click()
  await expect(win.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()
  expect(fs.existsSync(path.join(out, 'note.txt'))).toBe(false)
})

test('Delete key opens the confirm dialog; Keep changes nothing', async () => {
  await win.getByRole('row', { name: /note\.txt/ }).focus()
  await win.keyboard.press('Delete')
  const dlg = win.getByRole('dialog', { name: 'Remove download' })
  await dlg.getByRole('button', { name: 'Keep' }).click()
  await expect(win.getByRole('row', { name: /note\.txt/ })).toBeVisible()
  expect(fs.existsSync(path.join(out, 'note.txt'))).toBe(true)
})
