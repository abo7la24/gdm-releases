import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp, app, win

test.beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-setup-'))
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: 'st', download_dir: path.join(tmp, 'out') } }))
  app = await electron.launch({ args: ['.'], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
  win = await app.firstWindow()
  // do not really start a browser: record what would be started
  await app.evaluate(() => {
    globalThis.__spawned = []
    globalThis.__gdmLaunch = (exe, args) => { globalThis.__spawned.push([exe, args]) }
  })
})
test.afterEach(async () => {
  const p = app.process()
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
})


// The Windows clipboard can be held by another program; then reading it back proves nothing about our button.
async function clipboardWorks() {
  return app.evaluate(({ clipboard }) => { clipboard.writeText('probe'); return clipboard.readText() === 'probe' })
}

const openSetup = async () => {
  await win.getByRole('toolbar').getByRole('button', { name: 'Add to browser' }).click()
  return win.getByRole('dialog', { name: 'Add to your browser' })
}

test('B1 an add-on folder is ready for the browser, with the real files in it', async () => {
  const dlg = await openSetup()
  const folder = await dlg.getByLabel('Add-on folder').inputValue()
  expect(folder).toContain(path.join(tmp, 'data'))
  for (const f of ['manifest.json', 'background.js', 'popup.html', 'popup.js']) {
    expect(fs.readFileSync(path.join(folder, f), 'utf8')).toBe(fs.readFileSync(path.join('extension', f), 'utf8'))
  }
})

test('B2 Copy puts the folder path on the clipboard', async () => {
  test.skip(!(await clipboardWorks()), 'the system clipboard is busy')
  const dlg = await openSetup()
  const folder = await dlg.getByLabel('Add-on folder').inputValue()
  await dlg.getByRole('button', { name: 'Copy' }).click()
  await expect(dlg.getByRole('button', { name: 'Copied' })).toBeVisible()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5000 }).toBe(folder)
})

test('B3 the installed browsers are listed and the button opens their extensions page', async () => {
  const dlg = await openSetup()
  const buttons = dlg.getByRole('button', { name: /^Open in / })
  const n = await buttons.count()
  if (n === 0) {
    await expect(dlg.getByText('No Chrome, Edge or Brave found')).toBeVisible()
    return
  }
  await buttons.first().click()
  const spawned = await app.evaluate(() => globalThis.__spawned)
  expect(spawned).toHaveLength(1)
  expect(spawned[0][1][0]).toMatch(/^(chrome|edge|brave|opera|vivaldi):\/\/extensions$/)
})

test('B4 the reminder shows until the add-on connects, then goes away by itself', async () => {
  await expect(win.getByRole('status').filter({ hasText: 'not connected yet' })).toBeVisible()
  const dlg = await openSetup()
  await expect(dlg.getByText('Waiting for the add-on')).toBeVisible()
  // the add-on talks to the app (here: the same request it makes when its popup opens)
  const r = await fetch('http://127.0.0.1:17689/v1/status', { headers: { 'x-gdm-token': 'st' } })
  expect(r.status).toBe(200)
  await expect(dlg.getByText('Connected. The add-on has talked to GDM.')).toBeVisible({ timeout: 8000 })
  await dlg.getByRole('button', { name: 'Done' }).click()
  await expect(win.getByText('not connected yet')).toHaveCount(0)
})

test('B5 the setup dialog has no accessibility violations', async () => {
  const axe = (await import('axe-core')).default
  await openSetup()
  await win.evaluate(axe.source)
  const v = await win.evaluate(() => window.axe.run().then((r) => r.violations.map((x) => x.id + ': ' + x.nodes[0].html.slice(0, 70))))
  expect(v).toEqual([])
})

test('B6 Firefox has its own tab with a ready add-on file (version 2 manifest)', async () => {
  const clip = await clipboardWorks()
  const dlg = await openSetup()
  await dlg.getByRole('tab', { name: 'Firefox' }).click()
  const file = await dlg.getByLabel('Firefox add-on file').inputValue()
  expect(path.basename(file)).toBe('manifest.json')
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  expect(m.manifest_version).toBe(2)
  expect(m.background.scripts).toEqual(['background.js'])
  expect(m.browser_specific_settings.gecko.id).toContain('@')
  for (const f of ['background.js', 'popup.html', 'popup.js']) expect(fs.existsSync(path.join(path.dirname(file), f))).toBe(true)
  await dlg.getByRole('button', { name: 'Copy' }).click()
  if (clip) await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5000 }).toBe(file)
})

test('B7 the Firefox button opens its debugging page, or says Firefox is missing', async () => {
  const dlg = await openSetup()
  await dlg.getByRole('tab', { name: 'Firefox' }).click()
  const button = dlg.getByRole('button', { name: /^Open in Mozilla Firefox/ })
  if (await button.count()) {
    await button.click()
    const spawned = await app.evaluate(() => globalThis.__spawned)
    expect(spawned.at(-1)[1][0]).toBe('about:debugging#/runtime/this-firefox')
  } else {
    await expect(dlg.getByText('Firefox was not found on this computer')).toBeVisible()
  }
  await expect(dlg.getByText('removes a temporary add-on when it closes')).toBeVisible() // the honest limit
})
