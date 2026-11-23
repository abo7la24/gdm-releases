const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = new Set([
  'downloads:add', 'downloads:list', 'downloads:pause', 'downloads:resume', 'downloads:cancel',
  'downloads:retry', 'downloads:remove', 'downloads:openFile', 'downloads:openFolder',
  'settings:get', 'settings:set', 'dialog:pickFolder',
  'browser:info', 'browser:open', 'browser:copyPath', 'browser:showFolder',
  'media:open', 'media:tools', 'media:update', 'update:state', 'update:check', 'update:install',
])

contextBridge.exposeInMainWorld('swift', {
  invoke(channel, ...args) {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error('blocked channel'))
    return ipcRenderer.invoke(channel, ...args)
  },
  onUpdateState(cb) {
    const fn = (_e, state) => cb(state)
    ipcRenderer.on('update:state', fn)
    return () => ipcRenderer.removeListener('update:state', fn)
  },
  onLang(cb) {
    const fn = (_e, lang) => cb(lang)
    ipcRenderer.on('lang:set', fn)
    return () => ipcRenderer.removeListener('lang:set', fn)
  },
  onUpdate(cb) {
    const fn = (_e, list) => cb(list)
    ipcRenderer.on('downloads:update', fn)
    return () => ipcRenderer.removeListener('downloads:update', fn)
  },
})
