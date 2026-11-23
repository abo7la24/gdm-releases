import { useSyncExternalStore } from 'react'
import { FR } from './lang-fr'
import { AR } from './lang-ar'

// The English text is the key. A missing translation falls back to English, and a test fails if one is missing.
export type Lang = 'en' | 'ar' | 'fr'
export const LANGS: Lang[] = ['en', 'ar', 'fr']
export const DICT: Record<'ar' | 'fr', Record<string, string>> = { ar: AR, fr: FR }

let current: Lang = 'en'
const subscribers = new Set<() => void>()

// Sets the language of this window: text, reading direction (Arabic reads right to left) and the page's language tag.
export function setLang(lang: string) {
  const next: Lang = (LANGS as string[]).includes(lang) ? (lang as Lang) : 'en'
  current = next
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next
    document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr'
  }
  subscribers.forEach((f) => f())
}

export const getLang = () => current
export const useLang = (): Lang => useSyncExternalStore((cb) => { subscribers.add(cb); return () => { subscribers.delete(cb) } }, () => current)

export function t(key: string, params?: Record<string, string | number>): string {
  let s = current === 'en' ? key : (DICT[current][key] ?? key)
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
  return s
}

// Dates and numbers: Latin digits in every language, so sizes and speeds read the same everywhere.
export const locale = () => ({ en: 'en-US', ar: 'ar-u-nu-latn', fr: 'fr-FR' })[current]

// Error sentences come from the engine in English; they are translated here, where they are shown.
export const KNOWN_ERRORS = [
  'That does not look like a web address.',
  'Only http and https links are supported.',
  'The server address could not be found.',
  'The server refused the connection.',
  'The connection was cut before the file finished.',
  'The server took too long to answer.',
  'The disk is full.',
  'No permission to write to that folder.',
  'Could not reach the server.',
  'The server stopped supporting partial downloads.',
  'The connection closed early.',
  'The file ended up the wrong size.',
  'That download no longer exists.',
  'The file is not there any more.',
  'That value is not allowed.',
  'That browser was not found.',
  'Something went wrong.',
  'This page is a list of videos. Open one video and try again.',
  'No video was found on this page.',
  'This video is protected (DRM) and cannot be downloaded.',
  'This video needs you to be signed in. Start it from the browser add-on so your session is used.',
  'This video is not available.',
  'The site is limiting requests. Try again later.',
  'The conversion helper is missing.',
  'The video could not be downloaded.',
  'The video helper is not installed.',
  'Could not download the helper.',
  'Could not verify the download.',
  'The download did not match its checksum, so it was not used.',
  'Could not unpack the helper.',
  'The update address must start with https://.',
  'The update file is not valid.',
  'Could not check for updates.',
  'Could not download the update.',
  'Updates are not set up yet. Enter the address of the update file.',
] as const

// Steps and notes that the app names in English and the window words in its own language.
export const KNOWN_TEXT = ['Looking at the page…', 'Getting the video helper…', 'Getting the conversion helper…'] as const

export function translateError(message: string | null | undefined): string {
  if (!message) return ''
  const m = /^The server replied (\d+)\.$/.exec(message)
  if (m) return t('The server replied {code}.', { code: m[1] })
  return (KNOWN_ERRORS as readonly string[]).includes(message) ? t(message) : message
}
