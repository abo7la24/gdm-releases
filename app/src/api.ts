import { translateError } from './i18n'
export type Status = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface Segment { idx: number; start: number; end: number; done: number; status: string }

export interface Download {
  id: string
  url: string
  file_name: string
  save_path: string
  size_bytes: number | null
  downloaded_bytes: number
  status: Status
  connections: number
  resumable: boolean
  error: string | null
  created_at: string
  completed_at: string | null
  segments: Segment[]
  speed: number
  kind?: 'media' // a video or audio taken from a web page
  note?: string // what the app is doing before the download starts, e.g. getting the helper
  noteProgress?: number
}

export interface Settings {
  download_dir: string
  temp_dir: string
  max_connections: number
  max_parallel: number
  speed_limit_kbps: number
  capture_enabled: boolean
  capture_skip_ext: string
  capture_prompt: boolean
  progress_window: boolean
  auto_pair: boolean
  ytdlp_auto_update: boolean
  app_auto_update: boolean
  update_url: string
  theme: 'system' | 'light' | 'dark'
  language: 'system' | 'en' | 'ar' | 'fr' // what the user chose
  lang: 'en' | 'ar' | 'fr' // what is actually shown
  show_toasts: boolean
  token: string
}

interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<any>
  onUpdate(cb: (list: Download[]) => void): () => void
  onLang(cb: (lang: string) => void): () => void
  onUpdateState(cb: (state: UpdateState) => void): () => void
}
declare global { interface Window { swift: Bridge } }

const s = () => window.swift
export interface UpdateState { status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'; current: string; version: string | null; progress: number; notes: Record<string, string> | null; error: string | null }

export interface MediaTools { ytdlp: { installed: boolean; version: string | null }; ffmpeg: { installed: boolean } }

export interface BrowserInfo { folder: string; firefoxFolder: string; firefoxFile: string; browsers: { id: string; name: string }[]; seenAt: number | null; everSeen: boolean }

export const api = {
  browserInfo: (): Promise<BrowserInfo> => window.swift.invoke('browser:info'),
  browserOpen: (id: string) => window.swift.invoke('browser:open', id),
  browserCopyPath: (which?: 'firefox') => window.swift.invoke('browser:copyPath', which),
  browserShowFolder: (which?: 'firefox') => window.swift.invoke('browser:showFolder', which),
  list: (): Promise<Download[]> => s().invoke('downloads:list'),
  add: (url: string, opts: { saveDir?: string; fileName?: string }): Promise<string> => s().invoke('downloads:add', url, opts),
  pause: (id: string) => s().invoke('downloads:pause', id),
  resume: (id: string) => s().invoke('downloads:resume', id),
  cancel: (id: string) => s().invoke('downloads:cancel', id),
  retry: (id: string) => s().invoke('downloads:retry', id),
  remove: (id: string, deleteFile: boolean) => s().invoke('downloads:remove', id, deleteFile),
  openFile: (id: string) => s().invoke('downloads:openFile', id),
  openFolder: (id: string) => s().invoke('downloads:openFolder', id),
  updateState: (): Promise<UpdateState> => s().invoke('update:state'),
  updateCheck: (): Promise<UpdateState> => s().invoke('update:check'),
  updateInstall: () => s().invoke('update:install'),
  onUpdateState: (cb: (state: UpdateState) => void) => s().onUpdateState(cb),
  openMedia: (url: string) => s().invoke('media:open', url),
  mediaTools: (): Promise<MediaTools> => s().invoke('media:tools'),
  mediaUpdate: (): Promise<MediaTools> => s().invoke('media:update'),
  getSettings: (): Promise<Settings> => s().invoke('settings:get'),
  setSetting: (key: string, value: unknown) => s().invoke('settings:set', key, value),
  pickFolder: (): Promise<string | null> => s().invoke('dialog:pickFolder'),
  onUpdate: (cb: (list: Download[]) => void) => s().onUpdate(cb),
  onLang: (cb: (lang: string) => void) => s().onLang(cb),
}

// Electron wraps errors as "Error invoking remote method ...: Error: message"
export const msg = (e: unknown) => translateError(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
