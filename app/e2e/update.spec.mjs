import { test, expect, _electron as electron } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const INSTALLER = crypto.randomBytes(300000)
const SHA = crypto.createHash('sha256').update(INSTALLER).digest('hex')
const CURRENT = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
let server, base, feed, tmp, app, win, log, proc

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/latest.json') { const b = Buffer.from(JSON.stringify(feed)); res.writeHead(200, { 'Content-Length': b.length }); return res.end(b) }
    if (req.url === '/setup.exe') { res.writeHead(200, { 'Content-Length': INSTALLER.length }); return res.end(INSTALLER) }
    res.writeHead(404); res.end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
test.afterAll(() => server.close())

async function boot(settings = {}) {
  feed = { version: '9.9.9', url: '/setup.exe', sha256: SHA, notes: { en: 'Faster downloads', fr: 'Téléchargements plus rapides', ar: 'تنزيلات أسرع' } }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-update-'))
  log = path.join(tmp, 'install.log')
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'data', 'gdm.json'), JSON.stringify({ downloads: {}, settings: { token: 'up', download_dir: path.join(tmp, 'out'), update_url: `${base}/latest.json`, ...settings } }))
  app = await electron.launch({ args: ['.'], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data'), GDM_TEST_INSTALL_LOG: log, GDM_NO_AUTO_UPDATE: '1', GDM_NO_BUILTIN_FEED: '1' } })
  win = await app.firstWindow()
  proc = app.process()
}
test.afterEach(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {}) // may already be closed by the test
  if (proc && proc.exitCode === null) await new Promise((r) => proc.once('exit', r))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp */ }
})

async function openUpdates() {
  await win.getByRole('button', { name: /^(Settings|Paramètres)$/ }).click()
  const dlg = win.getByRole('dialog')
  await dlg.getByRole('tab', { name: /^(Updates|Mises à jour)$/ }).click()
  return dlg
}
const exited = (p) => (p.exitCode !== null ? Promise.resolve() : new Promise((r) => p.once('exit', r)))
const installs = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

test('U1 check now: a newer version is found, fetched, checked, and offered in the window and in Settings', async () => {
  await boot()
  const dlg = await openUpdates()
  await expect(dlg.getByText(`Version ${CURRENT}`)).toBeVisible()
  await dlg.getByRole('button', { name: 'Check for updates now' }).click()
  await expect(dlg.getByRole('status')).toContainText('Version 9.9.9 is ready to install.', { timeout: 15000 })
  await expect(dlg.getByText('What is new: Faster downloads')).toBeVisible()
  await expect(dlg.getByRole('button', { name: 'Restart now to install' })).toBeVisible()
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await expect(win.getByRole('status').filter({ hasText: 'GDM 9.9.9 is ready' })).toBeVisible() // the reminder bar
  expect(fs.readdirSync(path.join(tmp, 'data', 'updates'))).toEqual(['gdm-setup-9.9.9.exe']) // fetched and kept, nothing half-done
})

test('U2 Restart now: the checked installer is started silently, then the program closes', async () => {
  await boot()
  const dlg = await openUpdates()
  await dlg.getByRole('button', { name: 'Check for updates now' }).click()
  await expect(dlg.getByRole('status')).toContainText('is ready to install', { timeout: 15000 })
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  const p = app.process()
  await win.getByRole('button', { name: 'Restart now', exact: true }).click()
  await exited(p)
  expect(installs()).toHaveLength(1)
  expect(installs()[0][0]).toMatch(/gdm-setup-9\.9\.9\.exe$/)
  expect(installs()[0][1]).toEqual(['/S', '--updated', '--force-run'])
})

test('U3 an update that was fetched installs when the program is closed (and not if that is switched off)', async () => {
  await boot()
  const dlg = await openUpdates()
  await dlg.getByRole('button', { name: 'Check for updates now' }).click()
  await expect(dlg.getByRole('status')).toContainText('is ready to install', { timeout: 15000 })
  const p = app.process()
  await app.evaluate(({ app: a }) => a.quit()) // an ordinary close
  await exited(p)
  expect(installs()).toHaveLength(1)
})

test('U3b with automatic updating switched off, closing does not install', async () => {
  await boot({ app_auto_update: false })
  const dlg = await openUpdates()
  await dlg.getByRole('button', { name: 'Check for updates now' }).click()
  await expect(dlg.getByRole('status')).toContainText('is ready to install', { timeout: 15000 })
  const p = app.process()
  await app.evaluate(({ app: a }) => a.quit())
  await exited(p)
  expect(installs()).toEqual([])
})

test('U4 an installer that does not match its checksum is refused and nothing is kept', async () => {
  await boot()
  const dlg = await openUpdates()
  feed.sha256 = '0'.repeat(64)
  await dlg.getByRole('button', { name: 'Check for updates now' }).click()
  await expect(dlg.getByRole('status')).toContainText('did not match its checksum', { timeout: 15000 })
  await expect(dlg.getByRole('button', { name: 'Restart now to install' })).toHaveCount(0)
  expect(fs.existsSync(path.join(tmp, 'data', 'updates')) ? fs.readdirSync(path.join(tmp, 'data', 'updates')) : []).toEqual([])
})

test('U5 the same version: you are told you have the latest', async () => {
  await boot()
  const dlg = await openUpdates()
  feed.version = CURRENT
  await dlg.getByRole('button', { name: 'Check for updates now' }).click()
  await expect(dlg.getByRole('status')).toContainText('You have the latest version.', { timeout: 15000 })
  await expect(win.getByText(/is ready\. It installs/)).toHaveCount(0)
})

test('U6 the update address must be https (or this computer): anything else is refused when saving', async () => {
  await boot()
  const dlg = await openUpdates()
  await dlg.getByLabel('Address of the update file').fill('http://example.com/latest.json')
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(win.getByRole('alert').filter({ hasText: 'not allowed' })).toBeVisible()
})

test('U7 without an address it says what to do', async () => {
  await boot({ update_url: '' })
  const dlg = await openUpdates()
  await dlg.getByRole('button', { name: 'Check for updates now' }).click()
  await expect(dlg.getByRole('status')).toContainText('Updates are not set up yet. Enter the address of the update file.')
})

test('U8 in French the messages and the news come in French', async () => {
  await boot({ language: 'fr' })
  const dlg = await openUpdates()
  await dlg.getByRole('button', { name: 'Rechercher des mises à jour maintenant' }).click()
  await expect(dlg.getByRole('status')).toContainText('La version 9.9.9 est prête à être installée.', { timeout: 15000 })
  await expect(dlg.getByText('Nouveautés : Téléchargements plus rapides')).toBeVisible()
})

test('U9 the Updates tab has no accessibility violations', async () => {
  const axe = (await import('axe-core')).default
  await boot()
  await openUpdates()
  await new Promise((r) => setTimeout(r, 400))
  await win.evaluate(axe.source)
  const v = await win.evaluate(() => window.axe.run().then((r) => r.violations.map((x) => `${x.id}: ${x.nodes[0].html.slice(0, 70)}`)))
  expect(v).toEqual([])
})
