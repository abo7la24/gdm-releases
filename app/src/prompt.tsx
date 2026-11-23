import { useFit } from './fit'
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import './styles.css'
import './windows.css'
import type { WindowInfo } from './gdm'
import { bytes, duration } from './format'
import { FileIcon } from './fileicon'
import { setLang, t, translateError, useLang } from './i18n'

type Kind = 'video' | 'audio'

function Prompt() {
  useFit()
  useLang()
  const [info, setInfo] = useState<WindowInfo | null>(null)
  const [name, setName] = useState('')
  const [dir, setDir] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<Kind>('video')
  const [height, setHeight] = useState(0) // 0 = the best there is
  const [audioId, setAudioId] = useState('original')

  useEffect(() => {
    window.gdm.info().then((i) => { setLang(i.lang ?? 'en'); setInfo(i); setName(i.fileName ?? ''); setDir(i.saveDir ?? ''); setIcon(i.icon ?? null) })
    const off1 = window.gdm.onLang(setLang)
    // a video page: the window opens at once and fills in as the page is read
    const off2 = window.gdm.onPrompt((next) => setInfo((prev) => ({ ...(prev ?? {}), ...next }) as WindowInfo))
    return () => { off1(); off2() }
  }, [])
  useEffect(() => { document.title = t('New download') })
  useEffect(() => {
    // the icon follows the file type, so renaming "a.mp4" to "a.zip" changes it
    if (!info) return
    const timer = setTimeout(() => window.gdm.icon(name || (kind === 'audio' ? 'a.m4a' : 'a.mp4')).then(setIcon), 250)
    return () => clearTimeout(timer)
  }, [name, info?.type, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Escape means "leave it to the browser": nothing is lost
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') window.gdm.choose(info?.mode === 'media' ? 'cancel' : 'browser') }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [info?.mode])

  const ready = info?.mode === 'media' && info.loading === false && !info.error
  useEffect(() => {
    // when the list of qualities arrives: fill in the file name and pick the choice made last time
    if (!ready || !info) return
    setName((n) => n || info.fileName || '')
    const last = info.last
    const hasVideo = (info.video ?? []).length > 0
    if (last?.kind === 'audio' && (info.audio ?? []).length) { setKind('audio'); setAudioId(last.format === 'mp3' ? 'mp3' : 'original') }
    else if (hasVideo) { setKind('video'); setHeight(last?.height && (info.video ?? []).some((v) => v.height === last.height) ? last.height : 0) }
    else setKind('audio')
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!info) return <p className="muted win">{t('Loading…')}</p>
  let host = info.url ?? ''
  try { host = new URL(info.url ?? '').host } catch { /* show the raw text */ }
  const isMedia = info.mode === 'media'
  const video = info.video ?? []
  const audio = info.audio ?? []

  async function start(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const media = isMedia ? { kind, height: kind === 'video' ? height : 0, format: kind === 'audio' && audioId === 'mp3' ? 'mp3' : 'original' } : undefined
    await window.gdm.choose('start', { saveDir: dir, fileName: name.trim() || undefined, media })
  }

  const option = kind === 'video' ? (video.find((v) => v.height === height) ?? video[0]) : audio.find((a) => a.id === audioId)
  const needsHelper = !!option?.needsFfmpeg && !info.ffmpegInstalled
  const sub = [info.site, info.uploader, info.duration ? duration(info.duration) : ''].filter(Boolean).join(' · ')

  return (
    <main><form className="win" onSubmit={start} aria-label={t('New download')}>
      <div className="brandrow">
        {isMedia && info.thumbnail
          ? <img className="thumb" src={info.thumbnail} alt="" width={128} height={72} />
          : <FileIcon src={icon} />}
        <div style={{ minWidth: 0 }}>
          <h1>{isMedia ? t('Video or audio from this page') : t('New download')}</h1>
          <span className="muted" dir="auto">{isMedia && info.title ? info.title : isMedia ? '' : t('GDM received a link from your browser.')}</span>
          {isMedia && sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
        </div>
      </div>

      {isMedia && info.loading && (
        <div role="status">
          <div>{info.step ? t(info.step) : t('Loading…')}{typeof info.progress === 'number' ? ` ${info.progress}%` : ''}</div>
          <div className={`pbar ${typeof info.progress === 'number' ? '' : 'unknown'}`} style={{ marginTop: 8 }}>
            <i style={typeof info.progress === 'number' ? { transform: `scaleX(${info.progress / 100})` } : undefined} />
          </div>
        </div>
      )}
      {isMedia && info.error && <p className="alert" role="alert">{translateError(info.error)}</p>}

      {(!isMedia || ready) && (
        <div className="field">
          <label htmlFor="p-name">{t('File name')}</label>
          <input id="p-name" type="text" dir="auto" value={name} onChange={(e) => setName(e.target.value)} disabled={!!info.error} />
        </div>
      )}

      {ready && (
        <>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 4 }}>{t('What to download')}</legend>
            <div style={{ display: 'flex', gap: 16 }}>
              <label className="switch"><input type="radio" name="kind" checked={kind === 'video'} disabled={!video.length} onChange={() => setKind('video')} />{t('Video')}</label>
              <label className="switch"><input type="radio" name="kind" checked={kind === 'audio'} disabled={!audio.length} onChange={() => setKind('audio')} />{t('Audio only')}</label>
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="p-quality">{t('Quality')}</label>
            {kind === 'video' ? (
              <select id="p-quality" value={height} onChange={(e) => setHeight(Number(e.target.value))}>
                <option value={0}>{t('Best available ({quality})', { quality: video[0] ? qualityLabel(video[0]) : '' })}</option>
                {video.map((v) => (
                  <option key={v.height} value={v.height}>
                    {qualityLabel(v)} · {String(v.ext).toUpperCase()}{v.size ? ` · ${t('about {size}', { size: bytes(v.size) })}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <select id="p-quality" value={audioId} onChange={(e) => setAudioId(e.target.value)}>
                {audio.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id === 'mp3' ? t('MP3 (converted)') : t('Original quality ({format})', { format: String(a.ext).toUpperCase() })}
                    {a.size ? ` · ${t('about {size}', { size: bytes(a.size) })}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          {needsHelper && <p className="muted" style={{ margin: 0 }}>{t('This choice needs a conversion helper (about 100 MB). It is downloaded once, automatically.')}</p>}
        </>
      )}

      {(!isMedia || ready) && (
        <div className="field">
          <label htmlFor="p-dir">{t('Save to')}</label>
          <div className="row">
            <input id="p-dir" type="text" dir="auto" value={dir} onChange={(e) => setDir(e.target.value)} />
            <button type="button" className="btn secondary" onClick={async () => { const p = await window.gdm.pickFolder(); if (p) setDir(p) }}>{t('Browse')}</button>
          </div>
        </div>
      )}
      {!isMedia && (
        <dl className="kv">
          <dt>{t('From')}</dt><dd dir="ltr" title={info.url}>{host}</dd>
          <dt>{t('Size')}</dt><dd>{info.error ? '—' : bytes(info.size ?? null)}</dd>
        </dl>
      )}
      {!isMedia && info.error && <p className="alert" role="alert">{t('Could not reach this link: {error}', { error: translateError(info.error) })}</p>}
      {!isMedia && !info.error && info.resumable === false && <p className="muted" style={{ margin: 0 }}>{t('This server does not allow resuming, so a pause would start over.')}</p>}
      <div className="actions">
        {!isMedia && <button type="button" className="btn secondary" onClick={() => window.gdm.choose('browser')}>{t('Let the browser do it')}</button>}
        <button type="button" className="btn secondary" onClick={() => window.gdm.choose('cancel')}>{t('Cancel')}</button>
        <button type="submit" className="btn primary" autoFocus disabled={busy || !!info.error || (isMedia && !ready)} aria-busy={busy}>{t('Download')}</button>
      </div>
    </form></main>
  )
}

function qualityLabel(v: { height: number; fps: number }): string {
  return v.fps ? t('{height}p {fps} fps', { height: v.height, fps: v.fps }) : t('{height}p', { height: v.height })
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Prompt /></React.StrictMode>)
