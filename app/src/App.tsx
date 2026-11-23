import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download as DownloadIcon, Pause, Play, Plus, Puzzle, Settings as Gear, Trash2, ArrowUp, ArrowDown, File } from 'lucide-react'
import { api, msg, type BrowserInfo, type Download, type Status, type UpdateState } from './api'
import { bytes, eta, percent, speed, statusLabel } from './format'
import { AddDialog, Bar, ConfirmRemove, DetailDialog, SettingsDialog } from './dialogs'
import { BrowserSetup } from './browsersetup'
import { locale, setLang, t, translateError, useLang } from './i18n'

type Filter = 'all' | 'active' | 'queued' | 'paused' | 'done' | 'stopped'
type SortKey = 'file_name' | 'size_bytes' | 'percent' | 'speed' | 'status' | 'created_at'

interface Toast { id: number; text: string; error?: boolean }

export function App() {
  useLang() // re-draw everything when the language changes
  const [list, setList] = useState<Download[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [sel, setSel] = useState<string[]>([])
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created_at', dir: -1 })
  const [dialog, setDialog] = useState<'add' | 'settings' | 'browser' | { detail: string } | { remove: string } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dir, setDir] = useState('')
  const [bInfo, setBInfo] = useState<BrowserInfo | null>(null)
  const [upd, setUpd] = useState<UpdateState | null>(null)
  const prev = useRef<Map<string, Status>>(new Map())

  const FILTERS: { id: Filter; label: string; test: (s: Status) => boolean }[] = [
    { id: 'all', label: t('All'), test: () => true },
    { id: 'active', label: t('Downloading'), test: (s) => s === 'downloading' },
    { id: 'queued', label: t('Waiting'), test: (s) => s === 'queued' },
    { id: 'paused', label: t('Paused'), test: (s) => s === 'paused' },
    { id: 'done', label: t('Done'), test: (s) => s === 'completed' },
    { id: 'stopped', label: t('Failed or cancelled'), test: (s) => s === 'failed' || s === 'cancelled' },
  ]
  const COLS: { key: SortKey; label: string; w: string }[] = [
    { key: 'file_name', label: t('Name'), w: '32%' },
    { key: 'size_bytes', label: t('Size'), w: '10%' },
    { key: 'percent', label: t('Progress'), w: '20%' },
    { key: 'speed', label: t('Speed'), w: '11%' },
    { key: 'status', label: t('Status'), w: '14%' },
    { key: 'created_at', label: t('Added'), w: '13%' },
  ]

  const toast = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random()
    setToasts((x) => [...x, { id, text, error }])
    if (!error) setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 5000)
  }, [])

  const apply = useCallback((next: Download[]) => {
    for (const d of next) {
      const was = prev.current.get(d.id)
      if (was && was !== d.status) {
        if (d.status === 'failed') toast(t('{name} failed: {error}', { name: d.file_name, error: translateError(d.error) }), true)
        if (d.status === 'completed') toast(t('{name} is done', { name: d.file_name }))
      }
    }
    prev.current = new Map(next.map((d) => [d.id, d.status]))
    setList(next)
  }, [toast])

  useEffect(() => {
    api.list().then(apply)
    api.getSettings().then((s) => { setDir(s.download_dir); setLang(s.lang) })
    const off1 = api.onUpdate(apply)
    const off2 = api.onLang(setLang) // the language can also change from elsewhere, for example the tray
    api.updateState().then(setUpd)
    const off3 = api.onUpdateState(setUpd)
    return () => { off1(); off2(); off3() }
  }, [apply])

  // until the browser add-on has connected once, keep a gentle reminder on screen
  useEffect(() => {
    let on = true
    const tick = () => api.browserInfo().then((i) => on && setBInfo(i)).catch(() => {})
    tick()
    const timer = setInterval(() => { if (!bInfo?.everSeen) tick() }, 10000)
    return () => { on = false; clearInterval(timer) }
  }, [bInfo?.everSeen])

  const act = (p: Promise<unknown>) => p.catch((e) => toast(msg(e), true))
  const all = list ?? []
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, all.filter((d) => f.test(d.status)).length])), [all]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!
    const val = (d: Download) => (sort.key === 'percent' ? percent(d) : (d[sort.key as keyof Download] as string | number | null) ?? 0)
    return all.filter((d) => f.test(d.status)).sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir)
  }, [all, filter, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = all.filter((d) => sel.includes(d.id))
  const canPause = selected.some((d) => d.status === 'downloading' || d.status === 'queued')
  const canResume = selected.some((d) => d.status === 'paused' || d.status === 'failed')
  const totalSpeed = all.reduce((n, d) => n + (d.status === 'downloading' ? d.speed : 0), 0)
  const active = all.filter((d) => d.status === 'downloading').length

  function click(e: React.MouseEvent, id: string) {
    if (e.ctrlKey || e.metaKey) setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
    else if (e.shiftKey && sel.length) {
      const ids = shown.map((d) => d.id)
      const a = ids.indexOf(sel[sel.length - 1])
      const b = ids.indexOf(id)
      setSel(ids.slice(Math.min(a, b), Math.max(a, b) + 1))
    } else setSel([id])
  }

  function key(e: React.KeyboardEvent, d: Download, i: number) {
    const rows = e.currentTarget.parentElement!.children
    if (e.key === 'ArrowDown') { e.preventDefault(); (rows[i + 1] as HTMLElement | undefined)?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (rows[i - 1] as HTMLElement | undefined)?.focus() }
    else if (e.key === 'Enter') setDialog({ detail: d.id })
    else if (e.key === ' ') { e.preventDefault(); setSel((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id])) }
    else if (e.key === 'Delete') setDialog({ remove: d.id })
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      setMenu({ x: r.left + 40, y: r.bottom, id: d.id })
    }
  }

  const find = (id: string) => all.find((d) => d.id === id)
  const detail = typeof dialog === 'object' && dialog && 'detail' in dialog ? find(dialog.detail) : undefined
  const removing = typeof dialog === 'object' && dialog && 'remove' in dialog ? find(dialog.remove) : undefined
  const close = () => setDialog(null)

  return (
    <div className="app" onClick={() => setMenu(null)}>
      <header className="toolbar">
        <img className="brand" src="./logo.png" alt="" width={24} height={24} />
        <h1 className="sr">{t('Genius Download Manager downloads')}</h1>
        <div className="tools" role="toolbar" aria-label={t('Actions')}>
        <button className="btn primary" onClick={() => setDialog('add')}><Plus size={16} /> {t('Add link')}</button>
        <span className="sep" />
        <button className="btn" disabled={!canResume} onClick={() => selected.forEach((d) => act(api.resume(d.id)))}><Play size={16} /> {t('Resume')}</button>
        <button className="btn" disabled={!canPause} onClick={() => selected.forEach((d) => act(api.pause(d.id)))}><Pause size={16} /> {t('Pause')}</button>
        <button className="btn" disabled={!selected.length} onClick={() => selected.length === 1 ? setDialog({ remove: selected[0].id }) : selected.forEach((d) => act(api.remove(d.id, false)))}><Trash2 size={16} /> {t('Remove')}</button>
        <span className="grow" />
        <button className="btn" onClick={() => setDialog('browser')}><Puzzle size={16} /> {t('Add to browser')}</button>
        <button className="btn" onClick={() => setDialog('settings')}><Gear size={16} /> {t('Settings')}</button>
        </div>
      </header>

      <nav className="sidebar" aria-label={t('Filter downloads')}>
        {FILTERS.map((f) => (
          <button key={f.id} aria-current={filter === f.id} onClick={() => { setFilter(f.id); setSel([]) }}>
            {f.label}<span className="count">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </nav>

      <main className="main">
        {upd?.status === 'ready' && (
          <div className="notice" role="status">
            <span>{t('GDM {version} is ready. It installs when you close the program, or right now.', { version: upd.version ?? '' })}</span>
            <button className="btn sm primary" onClick={() => api.updateInstall()}>{t('Restart now')}</button>
          </div>
        )}
        {bInfo && !bInfo.everSeen && (
          <div className="notice" role="status">
            <span>{t('Your browser is not connected yet, so downloads there will not come to GDM.')}</span>
            <button className="btn sm primary" onClick={() => setDialog('browser')}>{t('Add to browser')}</button>
          </div>
        )}
        {list === null ? (
          <table className="skeleton" aria-label={t('Loading downloads')}><tbody>
            {[0, 1, 2, 3].map((i) => <tr key={i}><td colSpan={6}><i style={{ width: `${70 - i * 10}%` }} /></td></tr>)}
          </tbody></table>
        ) : shown.length === 0 ? (
          <div className="empty"><div>
            <DownloadIcon size={32} aria-hidden />
            <h2>{all.length === 0 ? t('Nothing here yet') : t('Nothing in this list')}</h2>
            <p>{all.length === 0 ? t('Paste a link and it will show up here.') : t('Pick another filter on the left to see your other downloads.')}</p>
            {all.length === 0 && <button className="btn primary" onClick={() => setDialog('add')}><Plus size={16} /> {t('Add link')}</button>}
          </div></div>
        ) : (
          <table role="grid" aria-label={t('Downloads')}>
            <thead><tr>
              {COLS.map((c) => (
                <th key={c.key} style={{ width: c.w }} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                  <button onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
                    {c.label}{sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
              ))}
            </tr></thead>
            <tbody>
              {shown.map((d, i) => (
                <tr key={d.id} tabIndex={0} aria-selected={sel.includes(d.id)}
                  onClick={(e) => { e.stopPropagation(); click(e, d.id) }}
                  onDoubleClick={() => setDialog({ detail: d.id })}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!sel.includes(d.id)) setSel([d.id]); setMenu({ x: e.clientX, y: e.clientY, id: d.id }) }}
                  onKeyDown={(e) => key(e, d, i)}>
                  <td><div className="name" title={d.file_name}><File size={16} aria-hidden /><span dir="auto">{d.file_name}</span></div></td>
                  <td className="num">{bytes(d.size_bytes)}</td>
                  <td><div className="cell-progress"><Bar d={d} /><small>{d.size_bytes || d.status === 'completed' ? `${percent(d)}%` : ''}</small></div></td>
                  <td className="muted num">{speed(d.speed)}{eta(d) && ` · ${eta(d)}`}</td>
                  <td className={d.status === 'failed' ? 'err' : d.status === 'completed' ? 'ok' : d.status === 'paused' ? 'warn' : ''} title={d.error ? translateError(d.error) : undefined}>{statusLabel(d.status)}</td>
                  <td className="muted">{new Date(d.created_at).toLocaleDateString(locale())}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>

      <footer className="statusbar">
        <span>{t('{n} active', { n: active })}</span>
        <span><bdi>{speed(totalSpeed) || t('Idle')}</bdi></span>
        <span>{t('{n} total', { n: all.length })}</span>
      </footer>

      {menu && (() => {
        const d = find(menu.id)
        if (!d) return null
        const item = (label: string, fn: () => unknown, show = true) => show && <button role="menuitem" onClick={() => { setMenu(null); fn() }}>{label}</button>
        return (
          <div className="menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setMenu(null)}>
            {item(t('Details'), () => setDialog({ detail: d.id }))}
            {item(t('Open file'), () => act(api.openFile(d.id)), d.status === 'completed')}
            {item(t('Show in folder'), () => act(api.openFolder(d.id)))}
            <div className="sep" />
            {item(t('Pause'), () => act(api.pause(d.id)), d.status === 'downloading' || d.status === 'queued')}
            {item(t('Resume'), () => act(api.resume(d.id)), d.status === 'paused' || d.status === 'failed')}
            {item(t('Start over'), () => act(api.retry(d.id)), d.status === 'failed' || d.status === 'cancelled' || d.status === 'paused')}
            {item(t('Copy link'), () => navigator.clipboard.writeText(d.url))}
            <div className="sep" />
            {item(t('Remove…'), () => setDialog({ remove: d.id }))}
          </div>
        )
      })()}

      {dialog === 'browser' && <BrowserSetup onClose={() => { close(); api.browserInfo().then(setBInfo) }} />}
      {dialog === 'add' && <AddDialog defaultDir={dir} onClose={close} onAdded={() => api.list().then(apply)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => { close(); api.getSettings().then((s) => setDir(s.download_dir)) }} onError={(m) => toast(m, true)} onSetup={() => setDialog('browser')} />}
      {detail && <DetailDialog d={detail} onClose={close} />}
      {removing && <ConfirmRemove d={removing} onClose={() => { close(); setSel([]) }} />}

      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className="toast" role={x.error ? 'alert' : 'status'}>
            <span>{x.text}</span>
            <button aria-label={t('Dismiss')} onClick={() => setToasts((y) => y.filter((z) => z.id !== x.id))}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
