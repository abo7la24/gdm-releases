import type { Download, Status } from './api'
import { locale, t } from './i18n'

export function bytes(n: number | null | undefined): string {
  if (n == null) return t('Unknown')
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`
}

export const speed = (n: number) => (n > 0 ? `${bytes(n)}/s` : '')

export function duration(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds))
  if (s < 60) return t('{n} s', { n: s })
  if (s < 3600) return t('{m} min {s} s', { m: Math.floor(s / 60), s: s % 60 })
  return t('{h} h {m} min', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) })
}

export function eta(d: Download): string {
  if (d.status !== 'downloading' || !d.speed || !d.size_bytes) return ''
  return duration((d.size_bytes - d.downloaded_bytes) / d.speed)
}

export const percent = (d: Download) =>
  d.status === 'completed' ? 100 : d.size_bytes ? Math.min(d.kind === 'media' ? 99 : 100, Math.floor((d.downloaded_bytes / d.size_bytes) * 100)) : 0 // a video is not done until its pieces are joined

export function statusLabel(s: Status): string {
  switch (s) {
    case 'queued': return t('Waiting')
    case 'downloading': return t('Downloading')
    case 'paused': return t('Paused')
    case 'completed': return t('Done')
    case 'failed': return t('Failed')
    default: return t('Cancelled')
  }
}

export const when = (iso: string) => new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
