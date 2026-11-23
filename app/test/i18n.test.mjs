import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { DICT, setLang, t, translateError, getLang, locale, KNOWN_ERRORS } from '../src/i18n.ts'
import { extractKeys } from '../scripts/i18n-keys.mjs'
const require = createRequire(import.meta.url)
const { TEXT, tm, resolveLanguage } = require('../main/i18n.cjs')

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
const tags = (s) => [...s.matchAll(/<\/?b>/g)].length

describe('every text the windows show is translated', () => {
  const keys = extractKeys()
  it('finds the texts (guards the check itself)', () => {
    expect(keys.length).toBeGreaterThan(150)
    expect(keys).toContain('Add link')
    expect(keys).toContain('Remove “{name}”?')
  })
  for (const lang of ['fr', 'ar']) {
    it(`${lang}: no text is missing`, () => {
      expect(keys.filter((k) => !DICT[lang][k])).toEqual([])
    })
    it(`${lang}: no translation is left over from a text that no longer exists`, () => {
      expect(Object.keys(DICT[lang]).filter((k) => !keys.includes(k))).toEqual([])
    })
    it(`${lang}: every {placeholder} and <b> mark of the English text is kept`, () => {
      for (const k of keys) {
        expect(placeholders(DICT[lang][k]), k).toBe(placeholders(k))
        expect(tags(DICT[lang][k]), k).toBe(tags(k))
      }
    })
    it(`${lang}: nothing is left in English by mistake (except names and symbols)`, () => {
      const same = keys.filter((k) => DICT[lang][k] === k)
      const allowed = new Set(['Version {version}', '{height}p {fps} fps', 'Actions', 'Pause', 'Chrome, Edge, Brave, Opera', '{height}p', '{n} s', '{m} min {s} s', '{h} h {m} min', 'Installed ({version})', 'Installed', 'Chrome, Edge, Brave, Opera'])
      expect(same.filter((k) => !allowed.has(k))).toEqual([])
    })
  }
})

describe('the translator', () => {
  it('shows English by default and falls back to English for an unknown text', () => {
    setLang('en')
    expect(t('Add link')).toBe('Add link')
    setLang('fr')
    expect(t('a text nobody translated')).toBe('a text nobody translated')
  })
  it('fills in values', () => {
    setLang('fr')
    expect(t('{n} active', { n: 3 })).toBe('3 en cours')
    setLang('ar')
    expect(t('{n} active', { n: 3 })).toBe('3 نشط')
    expect(t('{done} of {total}', { done: '1 MB', total: '2 MB' })).toBe('1 MB من 2 MB')
  })
  it('knows which languages read right to left, and ignores a language it does not have', () => {
    setLang('ar'); expect(getLang()).toBe('ar')
    setLang('xx'); expect(getLang()).toBe('en')
  })
  it('uses Latin digits in dates and numbers in every language', () => {
    setLang('ar')
    expect(new Date(Date.UTC(2026, 10, 21)).toLocaleDateString(locale(), { timeZone: 'UTC' })).toMatch(/2026/)
  })
  it('translates error sentences, including the one with a number', () => {
    setLang('fr')
    expect(translateError('The server replied 404.')).toBe('Le serveur a répondu 404.')
    expect(translateError('The disk is full.')).toBe('Le disque est plein.')
    expect(translateError('some odd message')).toBe('some odd message')
    expect(translateError(null)).toBe('')
    for (const e of KNOWN_ERRORS) expect(DICT.ar[e], e).toBeTruthy()
    setLang('en')
  })
})

describe('texts of the main program (tray menu, question about an add-on)', () => {
  const english = Object.keys(TEXT.fr)
  it('exist in both languages with the same keys', () => {
    expect(Object.keys(TEXT.ar).sort()).toEqual(english.sort())
  })
  it('keep their {placeholders}', () => {
    for (const k of english) for (const l of ['fr', 'ar']) expect(placeholders(TEXT[l][k]), `${l}: ${k}`).toBe(placeholders(k))
  })
  it('translate, and fill in values', () => {
    expect(tm('fr', 'Quit')).toBe('Quitter')
    expect(tm('ar', 'Quit')).toBe('إنهاء')
    expect(tm('en', 'Quit')).toBe('Quit')
    expect(tm('fr', 'Extension: {origin}\n\nAllow it only if you just pressed Connect in the GDM extension. It will then be able to send downloads here.', { origin: 'chrome-extension://x' })).toContain('chrome-extension://x')
  })
})

describe('choosing the language', () => {
  it('an explicit choice wins over Windows', () => {
    expect(resolveLanguage('fr', ['ar-SA'])).toBe('fr')
  })
  it('System follows the first language of Windows that we have', () => {
    expect(resolveLanguage('system', ['de-DE', 'ar-EG', 'en-US'])).toBe('ar')
    expect(resolveLanguage('system', ['fr-CA'])).toBe('fr')
  })
  it('falls back to English when none of them is supported', () => {
    expect(resolveLanguage('system', ['de-DE', 'ja-JP'])).toBe('en')
    expect(resolveLanguage('system', [])).toBe('en')
    expect(resolveLanguage('system', undefined)).toBe('en')
  })
  it('the test override is used before Windows', () => {
    expect(resolveLanguage('system', ['ar-EG'], 'en')).toBe('en')
  })
})
