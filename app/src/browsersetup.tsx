import { useEffect, useState } from 'react'
import { api, type BrowserInfo } from './api'
import { Modal } from './dialogs'
import { t, useLang } from './i18n'
import { rich } from './rich'

type Family = 'chromium' | 'firefox'

// Walks the user through adding the add-on to Chrome, Edge, Brave and the like, or to Firefox.
export function BrowserSetup({ onClose }: { onClose: () => void }) {
  useLang()
  const [info, setInfo] = useState<BrowserInfo | null>(null)
  const [tab, setTab] = useState<Family | null>(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let on = true
    const tick = () => api.browserInfo().then((i) => on && setInfo(i))
    tick()
    const timer = setInterval(tick, 2000) // so the status flips by itself once the add-on connects
    return () => { on = false; clearInterval(timer) }
  }, [])

  if (!info) return <Modal label={t('Add to your browser')} onClose={onClose}><p>{t('Loading…')}</p></Modal>

  const chromium = info.browsers.filter((b) => b.id !== 'firefox')
  const firefox = info.browsers.find((b) => b.id === 'firefox')
  const family: Family = tab ?? (chromium.length === 0 && firefox ? 'firefox' : 'chromium')
  const status = info.seenAt
    ? t('Connected. The add-on has talked to GDM.')
    : info.everSeen ? t('Connected before. Open your browser to reconnect.') : t('Waiting for the add-on…')
  const copy = async (which?: 'firefox') => { await api.browserCopyPath(which); setCopied(true); setTimeout(() => setCopied(false), 2500) }
  const open = (id: string) => api.browserOpen(id).catch((e) => setErr(String(e.message ?? e)))
  const list = { margin: 0, paddingInlineStart: 20, display: 'grid', gap: 'var(--space-3)' } as const

  return (
    <Modal label={t('Add to your browser')} onClose={onClose}>
      <h2>{t('Add GDM to your browser')}</h2>
      <div className="tabs" role="tablist" aria-label={t('Browser')}>
        <button role="tab" aria-selected={family === 'chromium'} onClick={() => setTab('chromium')}>{t('Chrome, Edge, Brave, Opera')}</button>
        <button role="tab" aria-selected={family === 'firefox'} onClick={() => setTab('firefox')}>Firefox</button>
      </div>

      {family === 'chromium' ? (
        <ol style={list}>
          <li>
            {t("Open your browser's extensions page.")}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {chromium.length === 0 && <span className="muted" dir="auto">{t('No Chrome, Edge or Brave found on this computer. Type chrome://extensions or edge://extensions in the address bar.')}</span>}
              {chromium.map((b) => <button key={b.id} className="btn secondary sm" onClick={() => open(b.id)}>{t('Open in {name}', { name: b.name })}</button>)}
            </div>
          </li>
          <li>{rich(t('Turn on <b>Developer mode</b> (the switch at the top of that page).'))}</li>
          <li>
            {rich(t('Press <b>Load unpacked</b> and choose this folder:'))}
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input type="text" dir="ltr" readOnly value={info.folder} aria-label={t('Add-on folder')} />
              <button className="btn secondary sm" onClick={() => copy()}>{copied ? t('Copied') : t('Copy')}</button>
              <button className="btn secondary sm" onClick={() => api.browserShowFolder()}>{t('Open folder')}</button>
            </div>
          </li>
          <li>{t('That is all. GDM and the add-on connect by themselves within a minute: the line below turns to Connected. (If it does not, click the GDM icon in the browser and press Connect.)')}</li>
        </ol>
      ) : (
        <ol style={list}>
          <li>
            {t("Open Firefox's add-on debugging page.")}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {firefox
                ? <button className="btn secondary sm" onClick={() => open('firefox')}>{t('Open in {name}', { name: firefox.name })}</button>
                : <span className="muted" dir="auto">{t('Firefox was not found on this computer. Install it, then open this window again. (In Firefox, type about:debugging in the address bar and choose This Firefox.)')}</span>}
            </div>
          </li>
          <li>
            {rich(t('Press <b>Load Temporary Add-on…</b> and choose this file:'))}
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input type="text" dir="ltr" readOnly value={info.firefoxFile} aria-label={t('Firefox add-on file')} />
              <button className="btn secondary sm" onClick={() => copy('firefox')}>{copied ? t('Copied') : t('Copy')}</button>
              <button className="btn secondary sm" onClick={() => api.browserShowFolder('firefox')}>{t('Open folder')}</button>
            </div>
          </li>
          <li>{t('That is all. GDM and the add-on connect by themselves within a minute: the line below turns to Connected. (If it does not, click the GDM button in the toolbar and press Connect.)')}</li>
        </ol>
      )}

      <p role="status" className={info.seenAt ? 'ok' : 'muted'} style={{ margin: 0, fontWeight: 600 }}>{status}</p>
      {err && <p className="alert" role="alert">{err}</p>}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {family === 'chromium'
          ? t('Chrome shows a note about developer-mode add-ons each time it starts; that is normal for add-ons that are not from the Chrome Web Store.')
          : t('Firefox removes a temporary add-on when it closes, so repeat these steps next time. To keep it for good, the add-on needs a file signed by Mozilla (free, through addons.mozilla.org).')}
      </p>
      <div className="actions"><button className="btn primary" onClick={onClose}>{t('Done')}</button></div>
    </Modal>
  )
}
