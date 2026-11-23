import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import './styles.css'
import './windows.css'
import type { WindowInfo } from './gdm'
import { bytes } from './format'
import { setLang, t, translateError, useLang } from './i18n'

function Toast() {
  useLang()
  const [info, setInfo] = useState<WindowInfo | null>(null)
  useEffect(() => {
    window.gdm.info().then((i) => { setLang(i.lang ?? 'en'); setInfo(i) })
    return window.gdm.onLang(setLang)
  }, [])
  const failed = info?.kind === 'failed'
  useEffect(() => { document.title = failed ? t('Download failed') : t('Download finished') })
  if (!info) return null
  const detail = failed
    ? translateError(info.detail || 'Something went wrong.')
    : t('{size} saved to {folder}', { size: bytes(info.size ?? null), folder: info.folder ?? '' })
  return (
    <main><div className={`toastwin ${failed ? 'failed' : ''}`} role={failed ? 'alert' : 'status'}
      onMouseEnter={() => window.gdm.hover(true)} onMouseLeave={() => window.gdm.hover(false)}>
      <img src="./logo.png" alt="" />
      <div style={{ minWidth: 0 }}>
        <h1 className={failed ? 'bad' : 'ok'}>{failed ? t('Download failed') : t('Download finished')}</h1>
        <div className="file" dir="auto" title={info.fileName}>{info.fileName}</div>
        <div className="detail" dir="auto">{detail}</div>
        <div className="row">
          {failed ? (
            <button className="btn sm primary" autoFocus onClick={() => window.gdm.act('retry')}>{t('Try again')}</button>
          ) : (
            <>
              <button className="btn sm primary" autoFocus onClick={() => window.gdm.act('open')}>{t('Open')}</button>
              <button className="btn sm secondary" onClick={() => window.gdm.act('folder')}>{t('Show in folder')}</button>
            </>
          )}
        </div>
      </div>
      <button className="x" aria-label={t('Close')} onClick={() => window.gdm.act('close')}>✕</button>
    </div></main>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Toast /></React.StrictMode>)
