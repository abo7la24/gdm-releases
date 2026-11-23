import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp, app, win

const launch = () => electron.launch({ args: ['.'], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })

test.beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-lang-'))
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: 'lg', download_dir: path.join(tmp, 'out') } }))
  app = await launch()
  win = await app.firstWindow()
})
test.afterEach(async () => {
  const p = app.process()
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
})

async function chooseLanguage(label) {
  await win.getByRole('button', { name: /^(Settings|Paramètres|الإعدادات)$/ }).click()
  const dlg = win.getByRole('dialog')
  await dlg.getByRole('radio', { name: label }).first().check()
  await dlg.getByRole('button', { name: /^(Cancel|Annuler|إلغاء)$/ }).click()
}

test('L1 English by default (the test pins Windows to English)', async () => {
  await expect(win.locator('html')).toHaveAttribute('lang', 'en')
  await expect(win.locator('html')).toHaveAttribute('dir', 'ltr')
})

test('L2 French: every label changes at once, the page language tag too, still left to right', async () => {
  await chooseLanguage('Français')
  await expect(win.getByRole('button', { name: 'Ajouter un lien' }).first()).toBeVisible()
  await expect(win.getByRole('button', { name: /^Tous/ })).toBeVisible()
  await expect(win.getByRole('heading', { name: 'Rien ici pour le moment' })).toBeVisible()
  await expect(win.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(win.locator('html')).toHaveAttribute('dir', 'ltr')
})

test('L3 Arabic: right to left, the side list moves to the right, the page language tag changes', async () => {
  await chooseLanguage('العربية')
  await expect(win.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(win.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(win.getByRole('button', { name: 'إضافة رابط' }).first()).toBeVisible()
  const [side, main] = await Promise.all([win.locator('.sidebar').boundingBox(), win.locator('.main').boundingBox()])
  expect(side.x).toBeGreaterThan(main.x) // the list sits on the right, as an Arabic reader expects
})

test('L4 the other windows follow: the new-download window in French', async () => {
  await chooseLanguage('Français')
  fetch('http://127.0.0.1:17689/v1/capture', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gdm-token': 'lg' }, body: JSON.stringify({ url: 'http://127.0.0.1:9/x.bin' }) }).catch(() => {})
  let prompt
  for (let i = 0; i < 100 && !prompt; i++) { prompt = app.windows().find((w) => w.url().includes('prompt.html') && !w.isClosed()); await new Promise((r) => setTimeout(r, 100)) }
  expect(prompt).toBeTruthy()
  await expect(prompt.getByRole('heading', { name: 'Nouveau téléchargement' })).toBeVisible()
  await expect(prompt.getByRole('alert')).toContainText('Impossible d’accéder à ce lien')
})

test('L5 the choice is remembered after a restart', async () => {
  await chooseLanguage('العربية')
  await expect(win.locator('html')).toHaveAttribute('dir', 'rtl')
  const p = app.process()
  await app.evaluate(({ app: a }) => a.quit())
  if (p.exitCode === null) await new Promise((r) => p.once('exit', r))
  app = await launch()
  win = await app.firstWindow()
  await expect(win.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(win.getByRole('button', { name: 'إضافة رابط' }).first()).toBeVisible()
})

test('L6 an error from the server is worded in the chosen language', async () => {
  await chooseLanguage('Français')
  await win.getByRole('button', { name: 'Ajouter un lien' }).first().click()
  const dlg = win.getByRole('dialog')
  await dlg.getByLabel('Lien').fill('http://127.0.0.1:9/x.bin') // nothing listens there
  await dlg.getByRole('button', { name: 'Démarrer le téléchargement' }).click()
  await expect(dlg.getByRole('alert')).toContainText(/serveur|connexion/i)
})

test('L7 the question about an unknown add-on is asked in the chosen language', async () => {
  await chooseLanguage('Français')
  await app.evaluate(({ dialog }) => { globalThis.__asked = []; dialog.showMessageBox = async (_w, o) => { globalThis.__asked.push(o); return { response: 1 } } })
  const r = await fetch('http://127.0.0.1:17689/v1/pair', { method: 'POST', headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } })
  expect(r.status).toBe(403)
  const o = (await app.evaluate(() => globalThis.__asked))[0]
  expect(o.title).toBe('Connecter une extension de navigateur ?')
  expect(o.buttons).toEqual(['Autoriser', 'Refuser'])
})

test('L8 every screen passes the accessibility scan in French and in Arabic', async () => {
  const axe = (await import('axe-core')).default
  for (const [label, addLabel] of [['Français', 'Ajouter un lien'], ['العربية', 'إضافة رابط']]) {
    await chooseLanguage(label)
    await new Promise((r) => setTimeout(r, 500))
    const scan = async () => { await win.evaluate(axe.source); return win.evaluate(() => window.axe.run().then((r) => r.violations.map((x) => `${x.id}: ${x.nodes[0].html.slice(0, 70)}`))) }
    expect(await scan(), label).toEqual([])
    await win.getByRole('button', { name: addLabel }).first().click()
    expect(await scan(), label + ' add dialog').toEqual([])
    await win.keyboard.press('Escape')
  }
})
