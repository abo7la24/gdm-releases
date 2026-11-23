// The two small windows GDM opens on its own: the "new download" window when a link arrives,
// and the corner notice when a download finishes or fails.
const { app, BrowserWindow, ipcMain, screen, nativeTheme } = require('electron')
const path = require('path')

const ICON = path.join(__dirname, '..', 'assets', 'icon.png')

let langProvider = () => 'en'
const setLanguageProvider = (fn) => { langProvider = fn }

// The icon Windows shows for this kind of file. It only depends on the ending of the name, so it works before the file exists.
const iconCache = new Map()
async function fileIconDataUrl(fileName) {
  const ext = (path.extname(String(fileName || '')).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.file').slice(0, 12)
  if (iconCache.has(ext)) return iconCache.get(ext)
  let url = null
  try {
    const img = await app.getFileIcon(`C:\\gdm-icon${ext}`, { size: 'large' })
    if (!img.isEmpty()) url = img.toDataURL()
  } catch { /* no icon for this type: the window shows a plain file symbol */ }
  iconCache.set(ext, url)
  return url
}

function make(opts, file) {
  const w = new BrowserWindow({
    ...opts, show: false, icon: ICON, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#ffffff', // no white flash in dark mode
    webPreferences: { preload: path.join(__dirname, 'preload-window.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  w.setMenu(null)
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.loadFile(path.join(__dirname, '..', 'dist', file))
  return w
}

const reviews = new Map() // webContents id -> { info, finish }
const toasts = [] // { win, data, timer, hover, onAction }

const CHOICES = new Set(['start', 'browser', 'cancel'])

// Asks the user what to do with an incoming link. Resolves { choice, saveDir?, fileName? }.
// Closing the window counts as "let the browser do it", so nothing is ever lost.
function openPrompt(info) {
  let resolveResult
  const result = new Promise((resolve) => { resolveResult = resolve })
  const media = info.mode === 'media' // a video page: a taller window with the choice of quality
  const w = make({
    width: media ? 600 : 560, height: media ? 560 : 360, resizable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, title: 'New download',
  }, 'prompt.html')
  const id = w.webContents.id
  let settled = false
  const entry = { info }
  const finish = (r) => {
    if (settled) return
    settled = true
    reviews.delete(id)
    resolveResult(r)
    if (!w.isDestroyed()) w.close()
  }
  entry.finish = finish
  reviews.set(id, entry)
  w.once('ready-to-show', () => { w.show(); w.setAlwaysOnTop(true, 'screen-saver'); w.focus() })
  w.on('closed', () => finish({ choice: 'browser' }))
  return {
    result,
    // lets the window show what we learn after it opened (the helper arriving, the list of qualities...)
    update(next) {
      entry.info = { ...entry.info, ...next }
      if (!w.isDestroyed()) w.webContents.send('prompt:update', { type: 'prompt', lang: langProvider(), ...entry.info })
    },
    close: () => finish({ choice: 'browser' }),
  }
}
const reviewCapture = (info) => openPrompt(info).result

const TOAST_W = 380
const TOAST_H = 136
const GAP = 8
const MARGIN = 16

function placeToasts() {
  const wa = screen.getPrimaryDisplay().workArea
  toasts.forEach((t, i) => {
    if (t.win.isDestroyed()) return
    t.win.setPosition(wa.x + wa.width - TOAST_W - MARGIN, wa.y + wa.height - (TOAST_H + GAP) * (i + 1) - MARGIN + GAP)
  })
}

function armTimer(t) {
  clearTimeout(t.timer)
  const ms = t.data.kind === 'failed' ? 20000 : 9000
  t.timer = setTimeout(() => { if (!t.win.isDestroyed()) t.win.close() }, ms)
}

// data: { kind: 'completed' | 'failed', id, fileName, detail }
function showToast(data, onAction) {
  const win = make({
    width: TOAST_W, height: TOAST_H, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, alwaysOnTop: true, skipTaskbar: true,
    title: data.kind === 'failed' ? 'Download failed' : 'Download finished',
  }, 'toast.html')
  const t = { win, data, timer: null, onAction }
  toasts.push(t)
  win.once('ready-to-show', () => { placeToasts(); win.showInactive(); win.setAlwaysOnTop(true, 'screen-saver'); armTimer(t) })
  win.on('closed', () => {
    clearTimeout(t.timer)
    toasts.splice(toasts.indexOf(t), 1)
    placeToasts()
  })
}

// One window per download that came from the browser: details, status, speed, time left and a progress bar.
const progress = new Map() // download id -> { win, getData, onAction }

function openProgress(id, getData, onAction) {
  if (progress.has(id)) return
  const offset = progress.size * 28 // later windows cascade so they do not hide each other
  const win = make({ width: 560, height: 360, resizable: false, maximizable: false, title: 'Download progress' }, 'progress.html')
  progress.set(id, { win, getData, onAction })
  win.once('ready-to-show', () => {
    if (offset) { const [x, y] = win.getPosition(); win.setPosition(x + offset, y + offset) }
    win.show()
  })
  win.on('closed', () => progress.delete(id)) // closing the window only hides it: the download carries on
}

function closeProgress(id) {
  const t = progress.get(id)
  if (t && !t.win.isDestroyed()) t.win.close()
}

// Called about five times a second while something downloads.
function pushProgress() {
  for (const [id, t] of progress) {
    if (t.win.isDestroyed()) continue
    const data = t.getData()
    if (!data) { closeProgress(id); continue }
    t.win.webContents.send('progress:update', data)
  }
}

function registerWindowIpc() {
  const progressFor = (e) => [...progress.values()].find((t) => !t.win.isDestroyed() && t.win.webContents.id === e.sender.id)
  const toastFor = (e) => toasts.find((t) => !t.win.isDestroyed() && t.win.webContents.id === e.sender.id)

  // The window asks what it should show.
  ipcMain.handle('window:icon', (_e, fileName) => fileIconDataUrl(fileName))
  ipcMain.handle('window:info', async (e) => {
    const lang = langProvider()
    const r = reviews.get(e.sender.id)
    if (r) return { type: 'prompt', lang, icon: await fileIconDataUrl(r.info.fileName), ...r.info }
    const t = toastFor(e)
    if (t) return { type: 'toast', lang, ...t.data }
    const p = progressFor(e)
    if (p) { const data = p.getData(); return { type: 'progress', lang, icon: await fileIconDataUrl(data?.fileName), ...data } }
    throw new Error('unknown window')
  })
  // The prompt window answers.
  ipcMain.handle('window:choose', (e, choice, opts = {}) => {
    const r = reviews.get(e.sender.id)
    if (!r || !CHOICES.has(choice)) throw new Error('not allowed')
    const m = opts.media
    const media = m && (m.kind === 'video' || m.kind === 'audio')
      ? { kind: m.kind, height: Number.isInteger(m.height) && m.height >= 0 && m.height <= 10000 ? m.height : 0, format: m.format === 'mp3' ? 'mp3' : 'original' }
      : undefined
    r.finish({ choice, saveDir: typeof opts.saveDir === 'string' ? opts.saveDir : undefined, fileName: typeof opts.fileName === 'string' ? opts.fileName : undefined, media })
  })
  // The notice asks for an action.
  ipcMain.handle('window:act', (e, action) => {
    const p = progressFor(e)
    if (p) {
      if (!['pause', 'resume', 'cancel', 'hide'].includes(action)) throw new Error('not allowed')
      if (action !== 'hide') p.onAction(action)
      if (action === 'hide' || action === 'cancel') p.win.close()
      return
    }
    const t = toastFor(e)
    if (!t || !['open', 'folder', 'retry', 'close'].includes(action)) throw new Error('not allowed')
    if (action !== 'close') t.onAction(action, t.data.id)
    t.win.close()
  })
  // The prompt and progress windows ask to be exactly as tall as their content (no empty gap, no scrollbar).
  ipcMain.handle('window:fit', (e, h) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w || w.isDestroyed() || reviews.get(e.sender.id) === undefined && !progressFor(e)) return
    if (Number.isFinite(h)) { const [cw] = w.getContentSize(); w.setContentSize(cw, Math.min(760, Math.max(200, Math.ceil(h)))) }
  })
  // Hovering the notice keeps it on screen.
  ipcMain.handle('window:hover', (e, on) => {
    const t = toastFor(e)
    if (!t) return
    if (on) clearTimeout(t.timer)
    else armTimer(t)
  })
}

module.exports = { reviewCapture, openPrompt, showToast, openProgress, closeProgress, pushProgress, registerWindowIpc, setLanguageProvider, fileIconDataUrl }
