// Firefox calls the add-on API `browser`, Chrome-style browsers call it `chrome`.
const ext = globalThis.browser || globalThis.chrome
const $ = (id) => document.getElementById(id)
const send = (m) => ext.runtime.sendMessage(m)
const size = (n) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`)

// The popup speaks the language chosen in GDM (the app tells us), or else the browser's.
const T = {
  fr: {
    'Checking the app…': "Vérification de l'application…",
    'Connect to GDM': 'Se connecter à GDM',
    'Send browser downloads to GDM': 'Envoyer les téléchargements du navigateur à GDM',
    'Download video or audio from this page': 'Télécharger la vidéo ou l’audio de cette page',
    'Media on this page': 'Médias sur cette page',
    'Nothing found yet. Play the video, then reopen this.': 'Rien trouvé pour le moment. Lancez la vidéo, puis rouvrez cette fenêtre.',
    'Connect by hand instead': 'Se connecter manuellement',
    'Token': 'Jeton',
    'Port': 'Port',
    'Save': 'Enregistrer',
    'Download': 'Télécharger',
    'Sent': 'Envoyé',
    'Failed': 'Échec',
    'Stream': 'Flux',
    'Connected. Downloads go to GDM.': 'Connecté. Les téléchargements vont dans GDM.',
    'Connected, but capture is turned off in the app.': "Connecté, mais la capture est désactivée dans l'application.",
    'Could not connect by itself. Make sure GDM is running, or press Connect.': "Connexion automatique impossible. Vérifiez que GDM est lancé, ou appuyez sur Se connecter.",
    'GDM is not running, so the browser keeps its own downloads.': "GDM n'est pas lancé : le navigateur garde ses propres téléchargements.",
    'Not connected: {error}': 'Non connecté : {error}',
    'Sent to GDM. Choose the quality there.': 'Envoyé à GDM. Choisissez la qualité là-bas.',
    'This page cannot be sent.': 'Cette page ne peut pas être envoyée.',
  },
  ar: {
    'Checking the app…': 'جارٍ فحص التطبيق…',
    'Connect to GDM': 'الاتصال بـ GDM',
    'Send browser downloads to GDM': 'إرسال تنزيلات المتصفح إلى GDM',
    'Download video or audio from this page': 'تنزيل الفيديو أو الصوت من هذه الصفحة',
    'Media on this page': 'الوسائط في هذه الصفحة',
    'Nothing found yet. Play the video, then reopen this.': 'لم يُعثر على شيء بعد. شغّل الفيديو ثم افتح هذه النافذة من جديد.',
    'Connect by hand instead': 'الاتصال يدوياً بدلاً من ذلك',
    'Token': 'الرمز',
    'Port': 'المنفذ',
    'Save': 'حفظ',
    'Download': 'تنزيل',
    'Sent': 'أُرسل',
    'Failed': 'فشل',
    'Stream': 'بث',
    'Connected. Downloads go to GDM.': 'متصل. تذهب التنزيلات إلى GDM.',
    'Connected, but capture is turned off in the app.': 'متصل، لكن الالتقاط معطّل في التطبيق.',
    'Could not connect by itself. Make sure GDM is running, or press Connect.': 'تعذّر الاتصال تلقائياً. تأكد أن GDM يعمل، أو اضغط الاتصال.',
    'GDM is not running, so the browser keeps its own downloads.': 'GDM لا يعمل، لذلك يحتفظ المتصفح بتنزيلاته.',
    'Not connected: {error}': 'غير متصل: {error}',
    'Sent to GDM. Choose the quality there.': 'أُرسل إلى GDM. اختر الجودة هناك.',
    'This page cannot be sent.': 'لا يمكن إرسال هذه الصفحة.',
  },
}
let lang = 'en'
const tr = (key, params = {}) => (((lang !== 'en' && T[lang]?.[key]) || key)).replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m))
function applyLanguage() {
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = tr(el.dataset.i18n)
}

async function init() {
  const c = await ext.storage.local.get({ port: 17689, token: '', enabled: true, lang: '' })
  const browserLang = String((ext.i18n && ext.i18n.getUILanguage && ext.i18n.getUILanguage()) || navigator.language || 'en').slice(0, 2)
  lang = ['en', 'ar', 'fr'].includes(c.lang) ? c.lang : ['ar', 'fr'].includes(browserLang) ? browserLang : 'en'
  applyLanguage()
  $('enabled').checked = c.enabled
  $('token').value = c.token
  $('port').value = c.port

  $('enabled').onchange = () => ext.storage.local.set({ enabled: $('enabled').checked })
  $('pair').onclick = async () => {
    $('state').className = ''
    $('pair').disabled = true
    const r = await send({ type: 'pair' })
    $('pair').disabled = false
    if (r.error) { $('state').className = 'bad'; $('state').textContent = tr('Not connected: {error}', { error: r.error }) } else check()
  }
  $('save').onclick = async () => {
    await ext.storage.local.set({ token: $('token').value.trim(), port: Number($('port').value) || 17689 })
    check()
  }

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true })

  // any page that may hold a video: GDM reads the page and offers every quality, or audio only
  $('video').onclick = async () => {
    if (!tab || !/^https?:/i.test(tab.url || '')) { $('state').className = 'bad'; $('state').textContent = tr('This page cannot be sent.'); return }
    const r = await send({ type: 'video', url: tab.url, referer: tab.url })
    $('state').className = r.error ? 'bad' : ''
    $('state').textContent = r.error ? tr('Not connected: {error}', { error: r.error }) : tr('Sent to GDM. Choose the quality there.')
    if (!r.error) setTimeout(() => window.close(), 900)
  }

  check()
  const { items = [] } = await send({ type: 'media', tabId: tab.id })
  if (!items.length) return
  const ul = $('media')
  ul.textContent = ''
  for (const m of items) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = decodeURIComponent(m.url.split('?')[0].split('/').pop() || m.url)
    name.title = m.url
    name.dir = 'auto'
    const meta = document.createElement('small')
    meta.textContent = m.stream ? tr('Stream') : `${m.type.split('/')[1] || m.type} ${size(m.size)}`
    const b = document.createElement('button')
    b.textContent = tr('Download')
    b.onclick = async () => {
      // a stream (HLS or DASH) goes to the video reader, a plain file goes straight to the downloader
      const r = m.stream ? await send({ type: 'video', url: m.url, referer: tab.url }) : await send({ type: 'grab', url: m.url, referer: tab.url })
      b.textContent = r.error ? tr('Failed') : tr('Sent')
      b.disabled = true
    }
    li.append(name, meta, b)
    ul.append(li)
  }
}

async function check() {
  const s = await send({ type: 'status' })
  const el = $('state')
  el.className = s.error ? 'bad' : ''
  if (s.lang && s.lang !== lang && ['en', 'ar', 'fr'].includes(s.lang)) { lang = s.lang; applyLanguage() }
  const notRunning = s.error && !/token/.test(s.error)
  $('pairrow').hidden = !(s.error && /token/.test(s.error)) // wrong or missing token: offer Connect
  el.textContent = s.error
    ? (notRunning ? tr('GDM is not running, so the browser keeps its own downloads.') : tr('Could not connect by itself. Make sure GDM is running, or press Connect.'))
    : s.capture ? tr('Connected. Downloads go to GDM.') : tr('Connected, but capture is turned off in the app.')
}

init()
