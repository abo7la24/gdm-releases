import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DARK_BG = 'rgb(20, 23, 28)'
const LIGHT_BG = 'rgb(255, 255, 255)'
let tmp, app, win

// colorScheme: null lets the windows follow the app's real theme, instead of Playwright's forced light
const launch = () => electron.launch({ args: ['.'], colorScheme: null, env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

test.beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-theme-'))
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: 'th', download_dir: path.join(tmp, 'out') } }))
  app = await launch()
  win = await app.firstWindow()
})
test.afterEach(async () => {
  const p = app.process()
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
})

async function chooseTheme(label) {
  await win.getByRole('button', { name: 'Settings' }).click()
  const dlg = win.getByRole('dialog', { name: 'Settings' })
  await dlg.getByRole('group', { name: 'Appearance' }).getByRole('radio', { name: label }).check()
  await dlg.getByRole('button', { name: 'Save' }).click()
}

test('T1 the choices are System, Light and Dark, and System is the default', async () => {
  await win.getByRole('button', { name: 'Settings' }).click()
  const dlg = win.getByRole('dialog', { name: 'Settings' })
  const group = dlg.getByRole('group', { name: 'Appearance' }) // the Language group also has "Same as the system"
  for (const name of ['Same as the system', 'Light', 'Dark']) await expect(group.getByRole('radio', { name })).toBeVisible()
  await expect(group.getByRole('radio', { name: 'Same as the system' })).toBeChecked()
})

test('T2 Dark turns the main window dark at once, Light turns it light', async () => {
  await chooseTheme('Dark')
  await expect.poll(() => bg(win)).toBe(DARK_BG)
  await chooseTheme('Light')
  await expect.poll(() => bg(win)).toBe(LIGHT_BG)
})

test('T3 Same as the system follows the system setting', async () => {
  await chooseTheme('Dark')
  await expect.poll(() => bg(win)).toBe(DARK_BG)
  await chooseTheme('Same as the system')
  const systemDark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)
  await expect.poll(() => bg(win)).toBe(systemDark ? DARK_BG : LIGHT_BG)
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('system')
})

test('T4 the other windows follow too (the new-download window)', async () => {
  await chooseTheme('Dark')
  // an unreachable link still opens the window, with the reason
  fetch('http://127.0.0.1:17689/v1/capture', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gdm-token': 'th' }, body: JSON.stringify({ url: 'http://127.0.0.1:9/x.bin' }) }).catch(() => {})
  let prompt
  for (let i = 0; i < 100 && !prompt; i++) { prompt = app.windows().find((w) => w.url().includes('prompt.html') && !w.isClosed()); await new Promise((r) => setTimeout(r, 100)) }
  expect(prompt).toBeTruthy()
  await expect.poll(() => bg(prompt)).toBe(DARK_BG)
  await chooseTheme('Light')
  await expect.poll(() => bg(prompt)).toBe(LIGHT_BG)
})

test('T5 the choice is remembered after a restart', async () => {
  await chooseTheme('Dark')
  await expect.poll(() => bg(win)).toBe(DARK_BG)
  const p = app.process()
  await app.evaluate(({ app: a }) => a.quit())
  if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
  app = await launch()
  win = await app.firstWindow()
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  await expect.poll(() => bg(win)).toBe(DARK_BG)
})

test('T6 every screen is readable in dark: no accessibility or contrast violations', async () => {
  const axe = (await import('axe-core')).default
  await chooseTheme('Dark')
  await expect.poll(() => bg(win)).toBe(DARK_BG)
  const scan = async () => {
    await new Promise((r) => setTimeout(r, 500)) // let the colour fade between themes finish
    await win.evaluate(axe.source)
    return win.evaluate(() => window.axe.run().then((r) => r.violations.map((x) => `${x.id}: ${x.nodes[0].html.slice(0, 80)}`)))
  }
  expect(await scan()).toEqual([]) // main window with the reminder bar
  await win.getByRole('toolbar').getByRole('button', { name: 'Add to browser' }).click()
  expect(await scan()).toEqual([]) // setup dialog
  await win.getByRole('tab', { name: 'Firefox' }).click()
  expect(await scan()).toEqual([])
  await win.getByRole('button', { name: 'Done', exact: true }).click()
  await win.getByRole('button', { name: 'Settings' }).click()
  expect(await scan()).toEqual([]) // settings
})
