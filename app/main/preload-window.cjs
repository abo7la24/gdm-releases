const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gdm', {
  info: () => ipcRenderer.invoke('window:info'),
  choose: (choice, opts) => ipcRenderer.invoke('window:choose', choice, opts),
  act: (action) => ipcRenderer.invoke('window:act', action),
  fit: (h) => ipcRenderer.invoke('window:fit', Number(h)),
  hover: (on) => ipcRenderer.invoke('window:hover', !!on),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  onPrompt(cb) {
    const fn = (_e, info) => cb(info)
    ipcRenderer.on('prompt:update', fn)
    return () => ipcRenderer.removeListener('prompt:update', fn)
  },
  icon: (fileName) => ipcRenderer.invoke('window:icon', String(fileName)),
  onLang(cb) {
    const fn = (_e, lang) => cb(lang)
    ipcRenderer.on('lang:set', fn)
    return () => ipcRenderer.removeListener('lang:set', fn)
  },
  onProgress(cb) {
    const fn = (_e, data) => cb(data)
    ipcRenderer.on('progress:update', fn)
    return () => ipcRenderer.removeListener('progress:update', fn)
  },
})
