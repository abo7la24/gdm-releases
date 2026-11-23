// Firefox calls the add-on API `browser`, Chrome-style browsers call it `chrome`.
const ext = globalThis.browser || globalThis.chrome
const DEFAULTS = { port: 17689, token: '', enabled: true, autoPair: true }
const cfg = async () => ({ ...DEFAULTS, ...(await ext.storage.local.get(Object.keys(DEFAULTS))) })

async function api(path, body) {
  const c = await cfg()
  const r = await fetch(`http://127.0.0.1:${c.port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-gdm-token': c.token },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `app replied ${r.status}`)
  return j
}

// Connect to the app by ourselves. The app accepts its own add-on without asking, so there is nothing to click.
async function pair() {
  const c = await cfg()
  const r = await fetch(`http://127.0.0.1:${c.port}/v1/pair`, { method: 'POST', signal: AbortSignal.timeout(120000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.token) {
    const err = new Error(j.error || `app replied ${r.status}`)
    err.denied = r.status === 403
    throw err
  }
  await ext.storage.local.set({ token: j.token, pairDeniedAt: 0 })
}

let pairing = null
async function ensurePaired() {
  try {
    await api('/v1/status')
    return true // already connected
  } catch (e) {
    if (!/token/i.test(e.message)) return false // the app is not running: try again later
  }
  if (!(await cfg()).autoPair) return false // connecting by itself is switched off
  const { pairDeniedAt = 0 } = await ext.storage.local.get('pairDeniedAt')
  if (Date.now() - pairDeniedAt < 3600000) return false // the user said no: do not ask again for an hour
  pairing ||= pair()
    .then(() => true)
    .catch(async (e) => { if (e.denied) await ext.storage.local.set({ pairDeniedAt: Date.now() }); return false })
    .finally(() => { pairing = null })
  return pairing
}

ext.runtime.onInstalled.addListener(() => ensurePaired())
ext.runtime.onStartup.addListener(() => ensurePaired())
if (ext.alarms) { // the app may start after the browser: look again every minute until connected
  ext.alarms.create('gdm-pair', { periodInMinutes: 1 })
  ext.alarms.onAlarm.addListener((a) => { if (a.name === 'gdm-pair') ensurePaired() })
}
ensurePaired()

async function cookieHeader(url) {
  const list = await ext.cookies.getAll({ url })
  return list.map((k) => `${k.name}=${k.value}`).join('; ')
}

// Browser started a download: if the app is running and capture is on, hand it over and drop the browser's copy.
ext.downloads.onCreated.addListener(async (item) => {
  const c = await cfg()
  const url = item.finalUrl || item.url
  if (!c.enabled || !/^https?:/i.test(url)) return
  try {
    if (!(await ensurePaired())) return // not connected and not able to connect: leave it to the browser
    const st = await api('/v1/status')
    if (!st.capture) return
    const r = await api('/v1/capture', {
      url, referer: item.referrer || '', cookies: await cookieHeader(url),
      fileName: (item.filename || '').split(/[\\/]/).pop() || undefined,
    })
    if (!r.ok) return // app declined (capture off or file type skipped): the browser keeps it
    await ext.downloads.cancel(item.id)
    await ext.downloads.erase({ id: item.id })
  } catch {
    /* app not running or token wrong: leave the browser download alone */
  }
})

// Media seen per tab, so the popup can list it.
const media = new Map()
ext.webRequest.onResponseStarted.addListener((d) => {
  if (d.tabId < 0 || d.statusCode >= 400) return
  const h = (n) => d.responseHeaders?.find((x) => x.name.toLowerCase() === n)?.value || ''
  const type = h('content-type').split(';')[0]
  const stream = /mpegurl|dash\+xml/i.test(type) || /\.(m3u8|mpd)(\?|$)/i.test(d.url) // HLS and DASH: GDM's video reader handles these
  const looksMedia = /^(video|audio)\//.test(type) || /\.(mp4|webm|mp3|m4a|ogg)(\?|$)/i.test(d.url)
  if (!looksMedia && !stream) return
  const total = /\/(\d+)$/.exec(h('content-range'))?.[1] || h('content-length')
  const m = media.get(d.tabId) || new Map()
  m.set(d.url, { url: d.url, type: type || 'media', size: total ? Number(total) : null, stream })
  media.set(d.tabId, m)
}, { urls: ['<all_urls>'] }, ['responseHeaders'])

ext.tabs.onUpdated.addListener((id, info) => { if (info.status === 'loading') media.delete(id) })
ext.tabs.onRemoved.addListener((id) => media.delete(id))

ext.runtime.onMessage.addListener((msg, _s, reply) => {
  ;(async () => {
    if (msg.type === 'media') return reply({ items: [...(media.get(msg.tabId)?.values() || [])] })
    if (msg.type === 'status') {
      const done = async () => { const st = await api('/v1/status'); if (st.lang) ext.storage.local.set({ lang: st.lang }); return st } // remembers the app's language for the popup
      try { return reply(await done()) } catch (e) {
        if (/token/i.test(e.message) && (await ensurePaired())) return reply(await done()) // opening the popup connects too
        throw e
      }
    }
    if (msg.type === 'video') {
      // a page or a stream with a video: the app reads it and lets the user choose the quality, or audio only
      if (!(await ensurePaired())) throw new Error('GDM is not running.')
      return reply(await api('/v1/media', { url: msg.url, referer: msg.referer || '', cookies: await cookieHeader(msg.url) }))
    }
    if (msg.type === 'pair') {
      await pair() // the Connect button: asks even if it was refused before
      return reply({ ok: true })
    }
    if (msg.type === 'grab') return reply(await api('/v1/capture', { url: msg.url, referer: msg.referer, cookies: await cookieHeader(msg.url) }))
  })().catch((e) => reply({ error: e.message }))
  return true // async reply
})
