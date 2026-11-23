// The few texts the main process shows itself (tray menu, the question about an unknown add-on).
// Everything inside the app's windows is translated in src/i18n.ts.
const SUPPORTED = ['en', 'ar', 'fr']

const TEXT = {
  fr: {
    'Open GDM': 'Ouvrir GDM',
    'Pause all': 'Tout mettre en pause',
    'Resume all': 'Tout reprendre',
    'Quit': 'Quitter',
    'Allow': 'Autoriser',
    'Deny': 'Refuser',
    'Connect a browser extension?': 'Connecter une extension de navigateur ?',
    'A browser extension wants to connect to Genius Download Manager.': 'Une extension de navigateur veut se connecter à Genius Download Manager.',
    'Extension: {origin}\n\nAllow it only if you just pressed Connect in the GDM extension. It will then be able to send downloads here.':
      'Extension : {origin}\n\nN’autorisez que si vous venez d’appuyer sur Connect dans l’extension GDM. Elle pourra alors envoyer des téléchargements ici.',
  },
  ar: {
    'Open GDM': 'فتح GDM',
    'Pause all': 'إيقاف الكل مؤقتاً',
    'Resume all': 'استئناف الكل',
    'Quit': 'إنهاء',
    'Allow': 'السماح',
    'Deny': 'رفض',
    'Connect a browser extension?': 'ربط إضافة المتصفح؟',
    'A browser extension wants to connect to Genius Download Manager.': 'تريد إضافة متصفح الاتصال بـ Genius Download Manager.',
    'Extension: {origin}\n\nAllow it only if you just pressed Connect in the GDM extension. It will then be able to send downloads here.':
      'الإضافة: {origin}\n\nاسمح بها فقط إذا ضغطتَ للتو على Connect في إضافة GDM. ستتمكن بعدها من إرسال التنزيلات إلى هنا.',
  },
}

function tm(lang, key, params = {}) {
  let s = (lang !== 'en' && TEXT[lang]?.[key]) || key
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
}

// "language" is what the user chose: system, en, ar or fr. "system" means the first language of Windows that we support.
function resolveLanguage(choice, systemLanguages, override) {
  if (SUPPORTED.includes(choice)) return choice
  for (const l of [override, ...(systemLanguages || [])]) {
    const code = String(l || '').toLowerCase().slice(0, 2)
    if (SUPPORTED.includes(code)) return code
  }
  return 'en'
}

module.exports = { tm, resolveLanguage, TEXT, SUPPORTED }
