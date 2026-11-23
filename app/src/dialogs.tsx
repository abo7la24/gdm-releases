import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, msg, type Download, type MediaTools, type Settings, type UpdateState } from './api'
import { bytes, duration, percent, speed, statusLabel, when } from './format'
import { getLang, t, translateError } from './i18n'

// Native <dialog>: focus trap, Esc to close and focus return come from the browser.
export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return (
    <dialog ref={ref} aria-label={label} onClose={onClose} onCancel={onClose}>
      <div className="dlg">{children}</div>
    </dialog>
  )
}

export function Bar({ d }: { d: Download }) {
  return (
    <div className={`bar ${d.status}`} role="progressbar" aria-valuenow={percent(d)} aria-valuemin={0} aria-valuemax={100} aria-label={t('Progress')}>
      <i style={{ width: `${percent(d)}%` }} />
    </div>
  )
}

function FolderField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="row">
        <input id={id} type="text" dir="auto" value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn secondary" onClick={async () => { const p = await api.pickFolder(); if (p) onChange(p) }}>{t('Browse')}</button>
      </div>
    </div>
  )
}

export function AddDialog({ defaultDir, onClose, onAdded }: { defaultDir: string; onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [dir, setDir] = useState(defaultDir)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!/^https?:\/\//i.test(url.trim())) return setError(t('Paste a link that starts with http:// or https://'))
    setBusy(true)
    try {
      await api.add(url.trim(), { saveDir: dir, fileName: name.trim() || undefined })
      onAdded()
      onClose()
    } catch (err) {
      setError(msg(err))
      setBusy(false)
    }
  }

  async function video() {
    setError('')
    if (!/^https?:\/\//i.test(url.trim())) return setError(t('Paste a link that starts with http:// or https://'))
    try { await api.openMedia(url.trim()); onClose() } catch (err) { setError(msg(err)) }
  }

  return (
    <Modal label={t('Add download')} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <h2>{t('Add a download')}</h2>
        <div className="field">
          <label htmlFor="url">{t('Link')}</label>
          <input id="url" type="text" dir="ltr" autoFocus value={url} onChange={(e) => setUrl(e.target.value)}
            aria-invalid={!!error} aria-describedby={error ? 'add-err' : undefined} placeholder="https://example.com/file.zip" />
        </div>
        <FolderField id="dir" label={t('Save to')} value={dir} onChange={setDir} />
        <div className="field">
          <label htmlFor="fname">{t('File name (optional)')}</label>
          <input id="fname" type="text" dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Taken from the link if left empty')} />
        </div>
        {error && <p id="add-err" className="alert" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="btn secondary" onClick={onClose}>{t('Cancel')}</button>
          <button type="button" className="btn secondary" onClick={video}>{t('Video or audio…')}</button>
          <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>{busy ? t('Checking link…') : t('Start download')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function DetailDialog({ d, onClose }: { d: Download; onClose: () => void }) {
  const total = d.size_bytes || 0
  const left = d.status === 'downloading' && d.speed && d.size_bytes ? duration((d.size_bytes - d.downloaded_bytes) / d.speed) : ''
  return (
    <Modal label={t('Download details')} onClose={onClose}>
      <h2 dir="auto" style={{ overflowWrap: 'anywhere' }}>{d.file_name}</h2>
      <Bar d={d} />
      {d.segments.length > 1 && (
        <div className="segs" aria-label={t('{n} connections', { n: d.segments.length })}>
          {d.segments.map((s) => {
            const len = s.end - s.start + 1
            return (
              <div key={s.idx} className={`bar ${d.status}`} style={{ flex: len / (total || len) }}>
                <i style={{ width: `${Math.min(100, (s.done / len) * 100)}%` }} />
              </div>
            )
          })}
        </div>
      )}
      <dl className="kv">
        <dt>{t('Status')}</dt><dd>{statusLabel(d.status)}{d.error ? ` — ${translateError(d.error)}` : ''}</dd>
        <dt>{t('Size')}</dt><dd>{bytes(d.size_bytes)} ({percent(d)}%)</dd>
        <dt>{t('Speed')}</dt><dd>{speed(d.speed) || '—'} {left && `· ${t('{time} left', { time: left })}`}</dd>
        <dt>{t('Connections')}</dt><dd>{d.segments.length || d.connections}{d.resumable ? '' : ` ${t('(this server does not allow resuming)')}`}</dd>
        <dt>{t('Saved to')}</dt><dd dir="ltr">{d.save_path}</dd>
        <dt>{t('Link')}</dt><dd dir="ltr">{d.url}</dd>
        <dt>{t('Added')}</dt><dd>{when(d.created_at)}</dd>
      </dl>
      <div className="actions">
        {(d.status === 'downloading' || d.status === 'queued') && <button className="btn secondary" onClick={() => api.pause(d.id)}>{t('Pause')}</button>}
        {(d.status === 'paused' || d.status === 'failed') && <button className="btn secondary" onClick={() => api.resume(d.id)}>{t('Resume')}</button>}
        {d.status !== 'completed' && d.status !== 'cancelled' && <button className="btn danger" onClick={() => api.cancel(d.id)}>{t('Cancel download')}</button>}
        <button className="btn primary" onClick={onClose}>{t('Close')}</button>
      </div>
    </Modal>
  )
}

type Tab = 'General' | 'Connections' | 'Speed' | 'Browser' | 'Video' | 'Updates'

export function SettingsDialog({ onClose, onError, onSetup }: { onClose: () => void; onError: (m: string) => void; onSetup: () => void }) {
  const [s, setS] = useState<Settings | null>(null)
  const [tab, setTab] = useState<Tab>('General')
  const [copied, setCopied] = useState(false)
  const [tools, setTools] = useState<MediaTools | null>(null)
  const [updating, setUpdating] = useState(false)
  const [upd, setUpd] = useState<UpdateState | null>(null)
  useEffect(() => { api.getSettings().then(setS) }, [])
  useEffect(() => { if (tab === 'Video') api.mediaTools().then(setTools) }, [tab])
  useEffect(() => {
    if (tab !== 'Updates') return
    api.updateState().then(setUpd)
    return api.onUpdateState(setUpd)
  }, [tab])
  if (!s) return <Modal label={t('Settings')} onClose={onClose}><p>{t('Loading…')}</p></Modal>

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v })
  async function save() {
    try {
      for (const k of ['download_dir', 'temp_dir', 'max_connections', 'max_parallel', 'speed_limit_kbps', 'capture_enabled', 'capture_skip_ext', 'capture_prompt', 'show_toasts', 'progress_window', 'auto_pair', 'ytdlp_auto_update', 'app_auto_update', 'update_url'] as const) {
        await api.setSetting(k, s![k])
      }
      onClose()
    } catch (e) { onError(msg(e)) }
  }
  const num = (k: 'max_connections' | 'max_parallel' | 'speed_limit_kbps', id: string, label: string, hint: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" value={s[k]} min={0} onChange={(e) => set(k, Math.floor(Number(e.target.value)))} />
      <span className="hint">{hint}</span>
    </div>
  )
  const tabs: [Tab, string][] = [['General', t('General')], ['Connections', t('Connections')], ['Speed', t('Speed')], ['Browser', t('Browser')], ['Video', t('Video')], ['Updates', t('Updates')]]

  return (
    <Modal label={t('Settings')} onClose={onClose}>
      <h2>{t('Settings')}</h2>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" style={{ display: 'grid', gap: 'var(--space-4)', minHeight: 150 }}>
        {tab === 'General' && (<>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 4 }}>{t('Language')}</legend>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {([['system', t('Same as the system')], ['en', 'English'], ['ar', 'العربية'], ['fr', 'Français']] as const).map(([v, label]) => (
                <label key={v} className="switch">
                  <input type="radio" name="language" checked={s.language === v}
                    onChange={() => { set('language', v); api.setSetting('language', v) /* applies at once, in every window */ }} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 4 }}>{t('Appearance')}</legend>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {([['system', t('Same as the system')], ['light', t('Light')], ['dark', t('Dark')]] as const).map(([v, label]) => (
                <label key={v} className="switch">
                  <input type="radio" name="theme" checked={s.theme === v}
                    onChange={() => { set('theme', v); api.setSetting('theme', v) /* applies at once, in every window */ }} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <FolderField id="s-dir" label={t('Download folder')} value={s.download_dir} onChange={(v) => set('download_dir', v)} />
          <FolderField id="s-tmp" label={t('Temporary folder')} value={s.temp_dir} onChange={(v) => set('temp_dir', v)} />
          <label className="switch">
            <input type="checkbox" checked={s.show_toasts} onChange={(e) => set('show_toasts', e.target.checked)} />
            {t('Show a notice in the corner when a download finishes or fails')}
          </label>
        </>)}
        {tab === 'Connections' && (<>
          {num('max_connections', 's-conn', t('Connections per download'), t('From 1 to 32. More is faster, but some servers refuse more than a few.'))}
          {num('max_parallel', 's-par', t('Downloads at the same time'), t('From 1 to 10. The rest wait in line.'))}
        </>)}
        {tab === 'Speed' && num('speed_limit_kbps', 's-lim', t('Speed limit (KB/s)'), t('0 means no limit. Shared by all downloads.'))}
        {tab === 'Updates' && (<>
          <p style={{ margin: 0 }}>{t('Version {version}', { version: upd?.current ?? '…' })}</p>
          <p role="status" style={{ margin: 0, fontWeight: 600 }} className={upd?.status === 'error' ? 'err' : ''}>
            {!upd || upd.status === 'idle' ? '' :
              upd.status === 'checking' ? t('Checking…') :
              upd.status === 'none' ? t('You have the latest version.') :
              upd.status === 'ready' ? t('Version {version} is ready to install.', { version: upd.version ?? '' }) :
              upd.status === 'error' ? t('Could not check for updates: {error}', { error: translateError(upd.error) }) :
              t('Downloading version {version}… {percent}%', { version: upd.version ?? '', percent: upd.progress })}
          </p>
          {upd?.notes && (upd.notes[getLang()] || upd.notes.en) && upd.status !== 'none' && <p className="muted" style={{ margin: 0 }} dir="auto">{t('What is new: {notes}', { notes: upd.notes[getLang()] || upd.notes.en })}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn secondary" disabled={upd?.status === 'checking' || upd?.status === 'downloading'} onClick={async () => { setUpd(await api.updateCheck()) }}>{t('Check for updates now')}</button>
            {upd?.status === 'ready' && <button className="btn primary" onClick={() => api.updateInstall()}>{t('Restart now to install')}</button>}
          </div>
          <label className="switch">
            <input type="checkbox" checked={s.app_auto_update} onChange={(e) => set('app_auto_update', e.target.checked)} />
            {t('Update GDM automatically (it installs when you close the program)')}
          </label>
          <div className="field">
            <label htmlFor="s-upd">{t('Address of the update file')}</label>
            <input id="s-upd" type="text" dir="ltr" value={s.update_url} placeholder="https://example.com/gdm/latest.json" onChange={(e) => set('update_url', e.target.value.trim())} />
            <span className="hint">{t('Where GDM looks for new versions. It must start with https://. Leave it empty to use the address built into this version.')}</span>
          </div>
        </>)}
        {tab === 'Video' && (<>
          <p style={{ margin: 0 }} className="muted">{t('Videos and audio from web pages are fetched by two helper programs. They are downloaded once, the first time you need them, and are not part of the installer.')}</p>
          <dl className="kv">
            <dt>{t('Video helper')}</dt>
            <dd>{tools ? (tools.ytdlp.installed ? t('Installed ({version})', { version: tools.ytdlp.version ?? '?' }) : t('Not installed yet')) : '…'}</dd>
            <dt>{t('Conversion helper')}</dt>
            <dd>{tools ? (tools.ffmpeg.installed ? t('Installed') : t('Not installed yet')) : '…'}</dd>
          </dl>
          <div>
            <button className="btn secondary" disabled={updating} aria-busy={updating} onClick={async () => { setUpdating(true); try { setTools(await api.mediaUpdate()) } catch (e) { onError(msg(e)) } setUpdating(false) }}>
              {updating ? t('Updating…') : tools?.ytdlp.installed ? t('Update the helpers now') : t('Get the video helper now')}
            </button>
          </div>
          <label className="switch">
            <input type="checkbox" checked={s.ytdlp_auto_update} onChange={(e) => set('ytdlp_auto_update', e.target.checked)} />
            {t('Update the helpers automatically (video helper weekly, conversion helper monthly)')}
          </label>
        </>)}
        {tab === 'Browser' && (<>
          <button className="btn secondary" style={{ justifySelf: 'start' }} onClick={onSetup}>{t('Add GDM to your browser…')}</button>
          <label className="switch">
            <input type="checkbox" checked={s.capture_enabled} onChange={(e) => set('capture_enabled', e.target.checked)} />
            {t('Take over downloads from the browser extension')}
          </label>
          <label className="switch">
            <input type="checkbox" checked={s.auto_pair} onChange={(e) => set('auto_pair', e.target.checked)} />
            {t("Accept GDM's own browser add-on automatically, without asking")}
          </label>
          <label className="switch">
            <input type="checkbox" checked={s.progress_window} onChange={(e) => set('progress_window', e.target.checked)} />
            {t('Show a progress window for each download that comes from the browser')}
          </label>
          <label className="switch">
            <input type="checkbox" checked={s.capture_prompt} onChange={(e) => set('capture_prompt', e.target.checked)} />
            {t('Show a window to confirm each link the browser sends')}
          </label>
          <div className="field">
            <label htmlFor="s-skip">{t('Leave these file types to the browser')}</label>
            <input id="s-skip" type="text" dir="ltr" value={s.capture_skip_ext} onChange={(e) => set('capture_skip_ext', e.target.value)} />
            <span className="hint">{t('Separate with commas, for example jpg, png. Everything else is taken over.')}</span>
          </div>
          <div className="field">
            <label htmlFor="s-token">{t('Extension token')}</label>
            <div className="row">
              <input id="s-token" type="text" dir="ltr" readOnly value={s.token} />
              <button className="btn secondary" onClick={async () => { await navigator.clipboard.writeText(s.token); setCopied(true) }}>{copied ? t('Copied') : t('Copy')}</button>
            </div>
            <span className="hint">{t('Usually you do not need this: the add-on connects by itself. The app listens on 127.0.0.1 port 17689 only.')}</span>
          </div>
        </>)}
      </div>
      <div className="actions">
        <button className="btn secondary" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" onClick={save}>{t('Save')}</button>
      </div>
    </Modal>
  )
}

export function ConfirmRemove({ d, onClose }: { d: Download; onClose: () => void }) {
  return (
    <Modal label={t('Remove download')} onClose={onClose}>
      <h2>{t('Remove “{name}”?', { name: d.file_name })}</h2>
      <p style={{ margin: 0 }} className="muted">
        {d.status === 'completed' ? t('You can remove it from the list only, or delete the file from your disk too. Deleting the file cannot be undone.') : t('The unfinished download will be dropped.')}
      </p>
      <div className="actions">
        <button className="btn secondary" onClick={onClose}>{t('Keep')}</button>
        <button className="btn secondary" onClick={() => { api.remove(d.id, false); onClose() }}>{t('Remove from list')}</button>
        {d.status === 'completed' && <button className="btn danger" onClick={() => { api.remove(d.id, true); onClose() }}>{t('Delete file too')}</button>}
      </div>
    </Modal>
  )
}
