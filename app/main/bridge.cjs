const http = require('http')
const crypto = require('crypto')

// Local door for the browser extension. Any web page can call localhost, so two locks:
// only extension origins (or no Origin at all, i.e. not a web page), and a secret token.
function startBridge(manager, { port = 17689, pair, review, onAdded, onMedia, getLang } = {}) {
  const inflight = new Map() // url -> pending review, so a double-sent link opens one window
  let pairing = false // only one approval prompt at a time
  const recent = new Map() // url -> {id, at}, so a double-sent capture makes one download

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || ''
    if (origin && !/^(chrome|moz|edge)-extension:\/\//.test(origin)) return end(res, 403, { error: 'forbidden' })
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-gdm-token')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Vary', 'Origin')
    if (req.method === 'OPTIONS') return end(res, 204)

    // One-click pairing: the extension asks, the app shows an Allow prompt, and only then is the token handed over.
    if (req.method === 'POST' && req.url === '/v1/pair') {
      if (!pair || !origin) return end(res, 403, { error: 'pairing is only for a browser extension' })
      if (pairing) return end(res, 429, { error: 'a pairing request is already waiting in the app' })
      pairing = true
      try {
        if (!(await pair(origin))) return end(res, 403, { error: 'pairing was not allowed in the app' })
        return end(res, 200, { ok: true, token: manager.settings().token })
      } catch (e) {
        return end(res, 502, { error: e.message })
      } finally {
        pairing = false
      }
    }

    const want = Buffer.from(manager.settings().token || '')
    const got = Buffer.from(String(req.headers['x-gdm-token'] || ''))
    if (!want.length || want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
      return end(res, 401, { error: 'bad token' })
    }

    manager.extensionSeenAt = Date.now() // a request with the right token: the add-on is connected
    if (!manager.settings().extension_seen) manager.setSetting('extension_seen', true)

    try {
      if (req.method === 'GET' && req.url === '/v1/status') {
        return end(res, 200, { ok: true, capture: !!manager.settings().capture_enabled, lang: getLang ? getLang() : 'en' })
      }
      if (req.method === 'POST' && req.url === '/v1/capture') {
        if (!manager.settings().capture_enabled) return end(res, 200, { ok: false, reason: 'capture is off' })
        const b = await readJson(req)
        const ext = (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(String(b.fileName || new URL(String(b.url)).pathname)) || [])[1]?.toLowerCase()
        const skip = String(manager.settings().capture_skip_ext || '').toLowerCase().split(/[,\s]+/).filter(Boolean)
        if (ext && skip.includes(ext)) return end(res, 200, { ok: false, reason: 'file type left to the browser' })
        const hit = recent.get(b.url)
        if (hit && Date.now() - hit.at < 5000) return end(res, 200, { ok: true, id: hit.id })
        const headers = {}
        if (b.referer) headers.Referer = String(b.referer)
        if (b.cookies) headers.Cookie = String(b.cookies)
        // With the "new download" window on, the user decides: start here, leave it to the browser, or cancel.
        if (review && manager.settings().capture_prompt) {
          let p = inflight.get(b.url)
          if (!p) {
            p = review({ url: String(b.url), headers, fileName: b.fileName }).finally(() => inflight.delete(b.url))
            inflight.set(b.url, p)
          }
          const r = await p
          if (r.id) { recent.set(b.url, { id: r.id, at: Date.now() }); onAdded?.(r.id) }
          return end(res, 200, r)
        }
        const id = await manager.add(String(b.url), { headers, fileName: b.fileName })
        recent.set(b.url, { id, at: Date.now() })
        onAdded?.(id)
        return end(res, 200, { ok: true, id })
      }
      if (req.method === 'POST' && req.url === '/v1/media') {
        // a page or stream with a video: the app looks at it and lets the user choose video quality or audio only
        if (!manager.settings().capture_enabled || !onMedia) return end(res, 200, { ok: false, reason: 'capture is off' })
        const b = await readJson(req)
        const url = String(b.url || '')
        if (!/^https?:\/\//i.test(url)) return end(res, 400, { error: 'not a web address' })
        const headers = {}
        if (b.referer) headers.Referer = String(b.referer)
        if (b.cookies) headers.Cookie = String(b.cookies)
        onMedia({ url, headers, title: b.title ? String(b.title) : undefined })
        return end(res, 200, { ok: true })
      }
      return end(res, 404, { error: 'not found' })
    } catch (e) {
      return end(res, 502, { error: e.message })
    }
  })

  server.on('error', (e) => console.error('bridge:', e.message)) // port taken: app still works, capture is off
  server.listen(port, '127.0.0.1')
  return server
}

function end(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(body ? JSON.stringify(body) : undefined)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let n = 0
    const parts = []
    req.on('data', (c) => {
      n += c.length
      if (n > 65536) { reject(new Error('body too large')); req.destroy() } else parts.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(parts).toString() || '{}')) } catch { reject(new Error('bad json')) }
    })
  })
}

module.exports = { startBridge }
