import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import './styles.css'
import './windows.css'
import type { WindowInfo } from './gdm'
import { bytes, duration, speed } from './format'
import { FileIcon } from './fileicon'
import { useFit } from './fit'
import { setLang, t, translateError, useLang } from './i18n'

type P = WindowInfo

function statusText(status: string | undefined): string {
  switch (status) {
    case 'queued': return t('Waiting to start')
    case 'downloading': return t('Downloading')
    case 'paused': return t('Paused')
    case 'failed': return t('Failed')
    case 'cancelled': return t('Cancelled')
    case 'completed': return t('Finished')
    default: return status ?? ''
  }
}

function Progress() {
  useLang()
  useFit()
  const [d, setD] = useState<P | null>(null)

  useEffect(() => {
    window.gdm.info().then((i) => { setLang(i.lang ?? 'en'); setD(i) })
    const off1 = window.gdm.onProgress((next) => setD((prev) => ({ ...(prev ?? {}), ...next, type: 'progress' } as P)))
    const off2 = window.gdm.onLang(setLang)
    return () => { off1(); off2() }
  }, [])
  useEffect(() => { document.title = t('Download progress') })
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') window.gdm.act('hide') } // hide only: the download carries on
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  if (!d) return null
  const size = d.size ?? null
  const done = d.downloaded ?? 0
  const frac = size ? Math.min(1, done / size) : 0
  const pct = Math.floor(frac * 100)
  const active = d.status === 'downloading'
  const remaining = active && size && (d.speed ?? 0) > 0 ? (size - done) / (d.speed as number) : null
  let host = d.url ?? ''
  try { host = new URL(d.url ?? '').host } catch { /* show the raw text */ }
  const segs = d.segments ?? []
  const ltr = (s: string) => `⁦${s}⁩` // keep numbers and units in one piece inside Arabic text

  return (
    <main className="win progresswin">
      <div className="brandrow">
        <FileIcon src={d.icon} />
        <div style={{ minWidth: 0 }}>
          <h1 title={d.fileName} className="trunc" dir="auto">{d.fileName}</h1>
          <span className={`state ${d.status === 'failed' ? 'err' : ''}`} role="status">{statusText(d.status)}{d.error ? `: ${translateError(d.error)}` : ''}</span>
          {d.note && <div className="muted" dir="auto">{t(d.note)}{typeof d.noteProgress === 'number' ? ` ${d.noteProgress}%` : ''}</div>}
        </div>
      </div>

      <div>
        <div className={`pbar ${size ? '' : 'unknown'} ${d.status}`} role="progressbar" aria-label={t('Download progress')}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={size ? pct : undefined}>
          <i style={size ? { transform: `scaleX(${frac})` } : undefined} />
        </div>
        <div className="pmeta">
          <span>{size ? `${pct}%` : t('Size unknown')}</span>
          <span>{size ? t('{done} of {total}', { done: ltr(bytes(done)), total: ltr(bytes(size)) }) : bytes(done)}</span>
        </div>
      </div>

      {segs.length > 1 && (
        <div className="segs" aria-hidden="true">
          {segs.map((s, i) => {
            const len = (s.end ?? 0) - (s.start ?? 0) + 1
            return <div key={i} className={`bar ${d.status}`} style={{ flex: len }}><i style={{ width: `${Math.min(100, ((s.done ?? 0) / len) * 100)}%` }} /></div>
          })}
        </div>
      )}

      <dl className="kv">
        <dt>{t('Speed')}</dt><dd>{active ? ltr(speed(d.speed ?? 0)) || '…' : '—'}</dd>
        <dt>{t('Time left')}</dt><dd>{remaining != null ? ltr(duration(remaining)) : active ? t('Working it out…') : '—'}</dd>
        <dt>{t('From')}</dt><dd dir="ltr" title={d.url}>{host}</dd>
        <dt>{t('Saved to')}</dt><dd title={d.savePath} className="path" dir="ltr">{d.savePath}</dd>
        {d.kind !== 'media' && <><dt>{t('Connections')}</dt><dd>{d.connections}{d.resumable === false ? ` ${t('(this server does not allow resuming)')}` : ''}</dd></>}
      </dl>

      <div className="actions">
        <button className="btn secondary" onClick={() => window.gdm.act('hide')}>{t('Hide')}</button>
        {(d.status === 'downloading' || d.status === 'queued') && <button className="btn secondary" onClick={() => window.gdm.act('pause')}>{t('Pause')}</button>}
        {(d.status === 'paused' || d.status === 'failed') && <button className="btn secondary" onClick={() => window.gdm.act('resume')}>{t('Resume')}</button>}
        <button className="btn danger" onClick={() => window.gdm.act('cancel')}>{t('Cancel download')}</button>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Progress /></React.StrictMode>)
