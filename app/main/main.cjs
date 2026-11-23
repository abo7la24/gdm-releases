const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, dialog, clipboard, nativeTheme } = require('electron')
const cp = require('child_process')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { Store } = require('./store.cjs')
const { toFirefoxManifest } = require('./firefox.cjs')
const { tm, resolveLanguage } = require('./i18n.cjs')
const { extensionIdFromKey, isOwnExtension } = require('./trust.cjs')
const { Manager, probe, checkUrl, sanitize } = require('./engine.cjs')
const { Tools } = require('./tools.cjs')
const { Updater, checkAddress } = require('./updater.cjs')
const pkg = require('../package.json')
const { probeMedia } = require('./media.cjs')
const { reviewCapture, openPrompt, showToast, openProgress, closeProgress, pushProgress, registerWindowIpc, setLanguageProvider } = require('./windows.cjs')
const { startBridge } = require('./bridge.cjs')

if (!app.requestSingleInstanceLock()) app.quit()

// Light on memory and CPU: a plain list does not need a graphics card, so no separate graphics process.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=192')

let win = null
let tray = null
let quitting = false
let manager

const ICON = path.join(__dirname, '..', 'assets', 'icon.png')
const TRAY_ICON = path.join(__dirname, '..', 'assets', 'tray.png')

function createWindow() {
  win = new BrowserWindow({
    width: 1000, height: 640, minWidth: 800, minHeight: 520, show: false, title: 'Genius Download Manager', backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#ffffff',
    icon: ICON, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.on('closed', () => { win = null }) // the page is freed; downloads carry on from the tray
}

function showWindow() {
  if (win && !win.isDestroyed()) { win.show(); win.focus() } else createWindow()
}

// The language in use: what the user chose, or the first language of Windows that we have (GDM_LANGUAGE is for tests).
function currentLang() {
  return resolveLanguage(manager.settings().language, app.getPreferredSystemLanguages?.(), process.env.GDM_LANGUAGE)
}

function buildTrayMenu() {
  const L = currentLang()
  const ids = () => manager.list()
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: tm(L, 'Open GDM'), click: showWindow },
    { label: tm(L, 'Pause all'), click: () => ids().filter((d) => d.status === 'downloading' || d.status === 'queued').forEach((d) => manager.pause(d.id)) },
    { label: tm(L, 'Resume all'), click: () => ids().filter((d) => d.status === 'paused').forEach((d) => manager.resume(d.id)) },
    { type: 'separator' },
    { label: tm(L, 'Quit'), click: () => { quitting = true; app.quit() } },
  ]))
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON))
  tray.setToolTip('Genius Download Manager')
  buildTrayMenu()
  tray.on('click', showWindow)
}

// Chrome and Edge load an add-on from a plain folder. Keep a copy in a stable place that survives app updates.
function installExtensionFolder() {
  const src = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, '..', 'extension')
  const dest = path.join(app.getPath('userData'), 'extension')
  const ff = path.join(app.getPath('userData'), 'extension-firefox')
  try {
    fs.mkdirSync(dest, { recursive: true })
    fs.cpSync(src, dest, { recursive: true, force: true })
    fs.mkdirSync(ff, { recursive: true })
    fs.cpSync(src, ff, { recursive: true, force: true })
    const chromeManifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'))
    fs.writeFileSync(path.join(ff, 'manifest.json'), JSON.stringify(toFirefoxManifest(chromeManifest), null, 2))
  } catch (e) {
    console.error('extension copy:', e.message)
  }
  return { dest, ff }
}

function findBrowsers() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const la = process.env.LOCALAPPDATA || ''
  const all = [
    { id: 'chrome', name: 'Google Chrome', url: 'chrome://extensions', paths: [`${pf}\\Google\\Chrome\\Application\\chrome.exe`, `${pf86}\\Google\\Chrome\\Application\\chrome.exe`, `${la}\\Google\\Chrome\\Application\\chrome.exe`] },
    { id: 'edge', name: 'Microsoft Edge', url: 'edge://extensions', paths: [`${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`] },
    { id: 'brave', name: 'Brave', url: 'brave://extensions', paths: [`${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, `${la}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`] },
    { id: 'firefox', name: 'Mozilla Firefox', url: 'about:debugging#/runtime/this-firefox', paths: [`${pf}\\Mozilla Firefox\\firefox.exe`, `${pf86}\\Mozilla Firefox\\firefox.exe`, `${la}\\Mozilla Firefox\\firefox.exe`, `${pf}\\Firefox Developer Edition\\firefox.exe`] },
    { id: 'opera', name: 'Opera', url: 'opera://extensions', paths: [`${la}\\Programs\\Opera\\opera.exe`, `${pf}\\Opera\\opera.exe`] },
    { id: 'vivaldi', name: 'Vivaldi', url: 'vivaldi://extensions', paths: [`${la}\\Vivaldi\\Application\\vivaldi.exe`] },
  ]
  return all.map((b) => ({ id: b.id, name: b.name, url: b.url, exe: b.paths.find((p) => fs.existsSync(p)) })).filter((b) => b.exe)
}

function validSetting(key, v) {
  const num = (min, max) => Number.isInteger(v) && v >= min && v <= max
  switch (key) {
    case 'max_connections': return num(1, 32)
    case 'max_parallel': return num(1, 10)
    case 'speed_limit_kbps': return num(0, 10000000)
    case 'capture_enabled':
    case 'auto_pair':
    case 'capture_prompt':
    case 'app_auto_update':
    case 'ytdlp_auto_update':
    case 'progress_window':
    case 'show_toasts': return typeof v === 'boolean'
    case 'theme': return v === 'system' || v === 'light' || v === 'dark'
    case 'language': return ['system', 'en', 'ar', 'fr'].includes(v)
    case 'update_url': try { if (v) checkAddress(v); return typeof v === 'string' && v.length < 300 } catch { return false }
    case 'capture_skip_ext': return typeof v === 'string' && v.length < 200 && /^[a-z0-9, ]*$/i.test(v)
    case 'download_dir':
    case 'temp_dir': return typeof v === 'string' && path.isAbsolute(v)
    default: return false // token and anything unknown cannot be set from the UI
  }
}

if (process.env.GDM_USERDATA) app.setPath('userData', process.env.GDM_USERDATA)

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const store = new Store(path.join(userData, 'gdm.json'))
  if (!store.data.settings.token) {
    store.data.settings.token = crypto.randomBytes(24).toString('hex')
    store.flush()
  }
  manager = new Manager(store, {
    download_dir: app.getPath('downloads'), temp_dir: path.join(userData, 'tmp'),
    max_connections: 8, max_parallel: 3, speed_limit_kbps: 0, capture_enabled: true, capture_skip_ext: 'jpg,jpeg,png,gif,webp,svg,ico',
    capture_prompt: true, show_toasts: true, progress_window: true, auto_pair: true, ytdlp_auto_update: true, app_auto_update: true, update_url: '', theme: 'system', language: 'system',
  })
  nativeTheme.themeSource = manager.settings().theme // follows the system unless the user chose
  setLanguageProvider(currentLang)
  // video and audio from web pages: the helper programs live in the app's data folder, not in the installer
  const tools = new Tools({ dir: process.env.GDM_TOOLS_DIR || path.join(userData, 'tools'), base: process.env.GDM_TOOLS_BASE || 'https://github.com' })
  manager.tools = tools
  const updater = new Updater({ current: app.getVersion(), dir: path.join(userData, 'updates'), feedUrl: () => manager.settings().update_url || (process.env.GDM_NO_BUILTIN_FEED ? '' : pkg.gdmUpdateUrl) || '' })
  updater.on('change', (state) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('update:state', state) })
  if (!process.env.GDM_NO_AUTO_UPDATE) {
    const auto = () => { if (manager.settings().app_auto_update && (manager.settings().update_url || pkg.gdmUpdateUrl)) updater.check(); maybeAutoUpdateHelper() }
    setTimeout(auto, 30000).unref?.()
    setInterval(auto, 24 * 3600000).unref?.()
  }
  let installNow = false
  let installChecked = false
  const runInstaller = (file, args) => {
    // GDM_TEST_INSTALL_LOG: tests only note what would be started, instead of starting an installer
    if (process.env.GDM_TEST_INSTALL_LOG) return fs.appendFileSync(process.env.GDM_TEST_INSTALL_LOG, JSON.stringify([file, args]) + '\n')
    cp.spawn(file, args, { detached: true, stdio: 'ignore' }).unref()
  }
  app.on('before-quit', (e) => {
    // a downloaded and checked update is installed when the program closes (or at once, when asked)
    if (installChecked || updater.state.status !== 'ready') return
    if (!installNow && !manager.settings().app_auto_update) return
    installChecked = true
    e.preventDefault()
    updater.installIfReady(runInstaller).catch(() => false).finally(() => { quitting = true; app.quit() })
  })
  // The "new download" window: look up the link, ask the user, then act on the answer.
  async function reviewLink({ url, headers, fileName }) {
    const base = { url, saveDir: manager.settings().download_dir }
    let info
    try {
      const p = await probe(checkUrl(url), headers)
      info = { ...base, fileName: fileName || p.fileName, size: p.size, resumable: p.resumable }
    } catch (e) {
      info = { ...base, fileName: fileName || '', error: e.message } // still shown, with the reason
    }
    const r = await reviewCapture(info)
    if (r.choice === 'start') {
      const id = await manager.add(url, { headers, saveDir: r.saveDir || undefined, fileName: r.fileName || undefined })
      return { ok: true, id }
    }
    if (r.choice === 'cancel') return { ok: true, cancelled: true } // the extension drops the browser's copy
    return { ok: false, reason: 'left to the browser' }
  }

  const { dest: extensionFolder, ff: firefoxFolder } = installExtensionFolder()
  let ownExtensionId = ''
  try { ownExtensionId = extensionIdFromKey(JSON.parse(fs.readFileSync(path.join(extensionFolder, 'manifest.json'), 'utf8')).key) } catch { /* no key: always ask */ }
  const browsers = findBrowsers()
  // The progress window for a download that came from the browser
  const publicView = (d) => ({
    id: d.id, fileName: d.file_name, url: d.url, savePath: d.save_path, size: d.size_bytes, downloaded: d.downloaded_bytes,
    status: d.status, speed: d.speed || 0, error: d.error, kind: d.kind || null, note: d.note || null, noteProgress: d.noteProgress ?? null, connections: d.segments.length || d.connections, resumable: d.resumable,
    segments: d.segments.map((s) => ({ start: s.start, end: s.end, done: s.done })),
  })
  const showProgress = (id) => {
    if (!manager.settings().progress_window) return
    openProgress(id, () => { try { return publicView(manager.get(id)) } catch { return null } }, (action) => {
      try { if (action === 'pause') manager.pause(id); else if (action === 'resume') manager.resume(id); else if (action === 'cancel') manager.cancel(id) } catch { /* removed meanwhile */ }
    })
  }

  // A page with a video: open the window, get the helper if it is missing, read the page, list the qualities, then download the choice.
  async function fetchThumb(url) {
    if (!url || !/^https?:/i.test(url)) return null
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 6000)
    try {
      const r = await fetch(url, { signal: ctl.signal })
      const type = r.headers.get('content-type') || ''
      if (!r.ok || !/^image\//.test(type)) return null
      const buf = Buffer.from(await r.arrayBuffer())
      return buf.length > 2000000 ? null : `data:${type};base64,${buf.toString('base64')}`
    } catch { return null } finally { clearTimeout(timer) }
  }

  const mediaBusy = () => [...manager.jobs.keys()].some((id) => manager.store.data.downloads[id]?.kind === 'media')
  function maybeAutoUpdateHelper() {
    const s = manager.settings()
    if (!s.ytdlp_auto_update || process.env.GDM_YTDLP_SCRIPT) return
    if (Date.now() - (s.media_checked_at || 0) < 7 * 86400000) return
    const ffmpegDue = Date.now() - (s.ffmpeg_checked_at || 0) > 28 * 86400000
    manager.setSetting('media_checked_at', Date.now())
    if (ffmpegDue) manager.setSetting('ffmpeg_checked_at', Date.now())
    tools.updateHelpers({ ffmpeg: ffmpegDue, busy: mediaBusy() }).catch(() => {})
  }

  async function reviewMedia({ url, headers = {}, fromBrowser = true, title }) {
    const prompt = openPrompt({ mode: 'media', url, loading: true, step: 'Looking at the page…', fileName: '', saveDir: manager.settings().download_dir })
    let found = null
    ;(async () => {
      try {
        if (!tools.ytdlpCommand()) {
          prompt.update({ step: 'Getting the video helper…', progress: 0 })
          await tools.ensureYtdlp((p) => prompt.update({ step: 'Getting the video helper…', progress: p }))
        }
        prompt.update({ step: 'Looking at the page…', progress: null })
        found = await probeMedia(tools, checkUrl(url), headers)
        maybeAutoUpdateHelper()
        const thumbnail = await fetchThumb(found.thumbnail)
        prompt.update({
          loading: false, title: found.title, fileName: sanitize(title || found.title), uploader: found.uploader, site: found.site,
          duration: found.duration, thumbnail, video: found.video, audio: found.audio, isLive: found.isLive,
          ffmpegInstalled: !!tools.ffmpegPath(), last: manager.settings().media_last || null,
        })
      } catch (e) {
        prompt.update({ loading: false, error: String(e.message || e) })
      }
    })()
    const r = await prompt.result
    if (r.choice !== 'start' || !r.media || !found) return {}
    const opt = r.media.kind === 'video'
      ? (found.video.find((v) => v.height === r.media.height) || found.video[0])
      : (found.audio.find((a) => (a.id === 'mp3') === (r.media.format === 'mp3')) || found.audio[0])
    manager.setSetting('media_last', { kind: r.media.kind, height: r.media.height, format: r.media.format })
    try {
      const id = await manager.addMedia(url, { headers, saveDir: r.saveDir, fileName: r.fileName, title: found.title, media: { ...r.media, needsFfmpeg: !!opt?.needsFfmpeg, size: opt?.size || null } })
      if (fromBrowser) showProgress(id)
      return { id }
    } catch { return {} }
  }

  startBridge(manager, {
    getLang: currentLang,
    onMedia: (a) => { reviewMedia(a) },
    onAdded: showProgress,
    review: reviewLink,
    pair: async (origin) => {
      // GDM's own add-on is accepted without asking (setting: auto_pair). Any other add-on still gets the question.
      if (manager.settings().auto_pair && isOwnExtension(origin, ownExtensionId)) return true
      showWindow()
      const L = currentLang()
      const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
        type: 'question', buttons: [tm(L, 'Allow'), tm(L, 'Deny')], defaultId: 1, cancelId: 1, noLink: true,
        title: tm(L, 'Connect a browser extension?'),
        message: tm(L, 'A browser extension wants to connect to Genius Download Manager.'),
        detail: tm(L, 'Extension: {origin}\n\nAllow it only if you just pressed Connect in the GDM extension. It will then be able to send downloads here.', { origin }),
      })
      return r.response === 0
    },
  })

  let pending = null
  let progTimer = null
  manager.on('change', () => {
    if (!progTimer) progTimer = setTimeout(() => { progTimer = null; pushProgress() }, 100) // smooth, but not more than ten a second
    if (pending) return
    pending = setTimeout(() => { // at most 4 pushes a second
      pending = null
      if (win && !win.isDestroyed() && win.isVisible()) win.webContents.send('downloads:update', manager.list())
    }, 250)
  })
  // Corner notice when a download finishes or fails.
  const onToast = (action, id) => {
    try {
      const d = manager.get(id)
      if (action === 'open' && fs.existsSync(d.save_path)) shell.openPath(d.save_path)
      else if (action === 'folder') (fs.existsSync(d.save_path) ? shell.showItemInFolder(d.save_path) : shell.openPath(path.dirname(d.save_path)))
      else if (action === 'retry') manager.retry(id)
    } catch { /* the download was removed meanwhile */ }
  }
  manager.on('completed', (d) => { closeProgress(d.id); return manager.settings().show_toasts && showToast({ kind: 'completed', id: d.id, fileName: d.file_name, size: d.size_bytes, folder: path.dirname(d.save_path) }, onToast) })
  manager.on('failed', (d) => { closeProgress(d.id); return manager.settings().show_toasts && showToast({ kind: 'failed', id: d.id, fileName: d.file_name, detail: d.error || 'Something went wrong.' }, onToast) })
  registerWindowIpc()

  const h = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a))
  h('downloads:list', () => manager.list())
  h('downloads:add', (url, opts = {}) => manager.add(url, { saveDir: opts.saveDir || undefined, fileName: opts.fileName || undefined }))
  h('downloads:pause', (id) => manager.pause(id))
  h('downloads:resume', (id) => manager.resume(id))
  h('downloads:cancel', (id) => manager.cancel(id))
  h('downloads:retry', (id) => manager.retry(id))
  h('downloads:remove', (id, deleteFile) => manager.remove(id, !!deleteFile))
  h('downloads:openFile', async (id) => {
    const d = manager.get(id)
    if (d.status !== 'completed' || !fs.existsSync(d.save_path)) throw new Error('The file is not there any more.')
    const err = await shell.openPath(d.save_path)
    if (err) throw new Error(err)
  })
  h('downloads:openFolder', (id) => {
    const d = manager.get(id)
    if (d.status === 'completed' && fs.existsSync(d.save_path)) shell.showItemInFolder(d.save_path)
    else shell.openPath(path.dirname(d.save_path))
  })
  // Help the user add the browser add-on
  h('browser:info', () => ({
    folder: extensionFolder,
    firefoxFolder,
    firefoxFile: path.join(firefoxFolder, 'manifest.json'),
    browsers: browsers.map((b) => ({ id: b.id, name: b.name })),
    seenAt: manager.extensionSeenAt || null,
    everSeen: !!manager.settings().extension_seen,
  }))
  h('browser:open', (id) => {
    const b = browsers.find((x) => x.id === id)
    if (!b) throw new Error('That browser was not found.')
    // tests replace globalThis.__gdmLaunch so no real browser opens (only code already running in this process can set it)
    const launch = globalThis.__gdmLaunch || ((exe, args) => cp.spawn(exe, args, { detached: true, stdio: 'ignore' }).unref())
    launch(b.exe, [b.url])
  })
  h('browser:copyPath', (which) => clipboard.writeText(which === 'firefox' ? path.join(firefoxFolder, 'manifest.json') : extensionFolder))
  h('browser:showFolder', (which) => shell.openPath(which === 'firefox' ? firefoxFolder : extensionFolder))
  h('media:open', (url) => { reviewMedia({ url: checkUrl(String(url)), fromBrowser: false }) })
  h('media:tools', async () => tools.status())
  h('media:update', async () => {
    if (!tools.ytdlpCommand()) await tools.ensureYtdlp()
    else await tools.updateHelpers({ busy: mediaBusy() })
    return tools.status()
  })
  h('update:state', () => updater.state)
  h('update:check', async () => { await updater.check(); return updater.state })
  h('update:install', () => { installNow = true; quitting = true; app.quit() })
  h('settings:get', () => ({ ...manager.settings(), lang: currentLang() }))
  h('settings:set', (key, value) => {
    if (!validSetting(key, value)) throw new Error('That value is not allowed.')
    if ((key === 'download_dir' || key === 'temp_dir') && typeof value === 'string') fs.mkdirSync(value, { recursive: true })
    manager.setSetting(key, value)
    if (key === 'theme') nativeTheme.themeSource = value // every window follows at once
    if (key === 'language') {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('lang:set', currentLang())
      if (tray) buildTrayMenu()
    }
  })
  h('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || undefined, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  createWindow()
  createTray()
  manager.schedule() // pick up downloads that were queued when the app last closed
  if (process.env.GDM_SHOT_DIR) screenshotRun(manager)
})

// Dev aid for replica-diff: GDM_SHOT_DIR=dir [GDM_SHOT_URL=link] saves S01 PNGs then quits.
async function screenshotRun(m) {
  const out = process.env.GDM_SHOT_DIR
  fs.mkdirSync(out, { recursive: true })
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const shot = async (name) => fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG())
  await wait(1200)
  await shot('S01-empty.png')
  if (process.env.GDM_SHOT_URL) {
    const id = await m.add(process.env.GDM_SHOT_URL)
    await wait(2500)
    await shot('S01-filled.png')
    await win.webContents.executeJavaScript(`document.querySelector('tbody tr')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
    await wait(600)
    await shot('S03-detail.png')
    m.pause(id)
  }
  quitting = true
  app.quit()
}

app.on('second-instance', showWindow)
app.on('before-quit', () => { quitting = true; manager?.store.flush() })
app.on('window-all-closed', () => { /* stay in tray */ })
