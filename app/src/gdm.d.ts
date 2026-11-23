export interface WindowInfo {
  type: 'prompt' | 'toast' | 'progress'
  lang?: string // language of this window: en, ar or fr
  icon?: string | null // the icon Windows shows for this kind of file, as an image address
  // prompt
  url?: string
  fileName?: string
  size?: number | null // bytes, or null when the server does not say
  resumable?: boolean
  saveDir?: string
  error?: string
  // a video page
  mode?: 'media'
  loading?: boolean
  step?: string
  progress?: number | null
  title?: string
  uploader?: string
  site?: string
  duration?: number | null
  thumbnail?: string | null
  video?: { height: number; fps: number; ext: string; size: number | null; needsFfmpeg: boolean }[]
  audio?: { id: string; ext: string; abr: number | null; size: number | null; needsFfmpeg: boolean }[]
  isLive?: boolean
  ffmpegInstalled?: boolean
  last?: { kind: 'video' | 'audio'; height: number; format: string } | null
  // progress
  note?: string | null
  noteProgress?: number | null
  kind?: 'completed' | 'failed' | 'media'
  savePath?: string
  downloaded?: number
  status?: string
  speed?: number
  connections?: number
  segments?: { start: number; end: number; done: number }[]
  // toast
  id?: string
  detail?: string
  folder?: string
}
declare global {
  interface Window {
    gdm: {
      info(): Promise<WindowInfo>
      choose(choice: 'start' | 'browser' | 'cancel', opts?: { saveDir?: string; fileName?: string; media?: { kind: 'video' | 'audio'; height: number; format: string } }): Promise<void>
      act(action: 'open' | 'folder' | 'retry' | 'close' | 'pause' | 'resume' | 'cancel' | 'hide'): Promise<void>
      onProgress(cb: (data: WindowInfo) => void): () => void
      hover(on: boolean): Promise<void>
      pickFolder(): Promise<string | null>
      icon(fileName: string): Promise<string | null>
      onLang(cb: (lang: string) => void): () => void
      onPrompt(cb: (info: WindowInfo) => void): () => void
    }
  }
}
