import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { toFirefoxManifest } = require('../main/firefox.cjs')
const { extensionIdFromKey, isOwnExtension } = require('../main/trust.cjs')

const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'))

describe('Firefox copy of the add-on', () => {
  const ff = toFirefoxManifest(manifest)
  it('is a version 2 manifest with an id and a background script', () => {
    expect(ff.manifest_version).toBe(2)
    expect(ff.browser_specific_settings.gecko.id).toMatch(/@/)
    expect(ff.background).toEqual({ scripts: ['background.js'] })
    expect(ff.browser_action.default_popup).toBe('popup.html')
  })
  it('asks for the same permissions, including every site', () => {
    for (const p of ['downloads', 'cookies', 'webRequest', 'storage', 'tabs', '<all_urls>']) expect(ff.permissions).toContain(p)
  })
  it('keeps the name and version of the Chrome one', () => {
    expect(ff.name).toBe(manifest.name)
    expect(ff.version).toBe(manifest.version)
  })
})

// Runs the add-on's background script against a pretend browser, once with Firefox's `browser` and once with Chrome's `chrome`.
function load(namespace) {
  const listeners = {}
  const ev = (name) => ({ addListener: (f) => { (listeners[name] ||= []).push(f) } })
  const store = { token: 't', port: 17689, enabled: true }
  const api = {
    storage: { local: { get: async () => ({ ...store }), set: async (v) => Object.assign(store, v) } },
    downloads: { onCreated: ev('downloads'), cancel: async () => {}, erase: async () => {}, search: async () => [] },
    webRequest: { onResponseStarted: ev('web') },
    tabs: { onUpdated: ev('tabsUpdated'), onRemoved: ev('tabsRemoved'), query: async () => [] },
    runtime: { onMessage: ev('message'), onInstalled: ev('installed'), onStartup: ev('startup') },
    cookies: { getAll: async () => [] },
  }
  const calls = []
  const ctx = {
    [namespace]: api, console, AbortSignal,
    fetch: async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ ok: true, capture: true }) } },
  }
  vm.runInNewContext(fs.readFileSync('extension/background.js', 'utf8'), ctx, { filename: 'background.js' })
  return { listeners, calls }
}

describe.each(['browser', 'chrome'])('add-on background script with the %s API', (ns) => {
  it('registers its listeners and answers a status question', async () => {
    const { listeners, calls } = load(ns)
    for (const k of ['downloads', 'web', 'message']) expect(listeners[k]?.length).toBeGreaterThan(0)
    const reply = new Promise((resolve) => {
      const kept = listeners.message[0]({ type: 'status' }, {}, resolve)
      expect(kept).toBe(true) // keeps the channel open for the async answer
    })
    expect(await reply).toMatchObject({ ok: true, capture: true })
    expect(calls[0]).toBe('http://127.0.0.1:17689/v1/status')
  })
})

it('popup script compiles', () => {
  expect(() => new vm.Script(fs.readFileSync('extension/popup.js', 'utf8'))).not.toThrow()
})

describe('which add-on the app accepts without asking', () => {
  const id = extensionIdFromKey(manifest.key)
  it('derives a 32-letter id (a to p) from the key in the manifest, the same every time', () => {
    expect(id).toMatch(/^[a-p]{32}$/)
    expect(extensionIdFromKey(manifest.key)).toBe(id)
    expect(extensionIdFromKey('AAAA')).not.toBe(id)
  })
  it('accepts its own add-on in Chrome-style browsers and any Firefox add-on', () => {
    expect(isOwnExtension(`chrome-extension://${id}`, id)).toBe(true)
    expect(isOwnExtension(`edge-extension://${id}`, id)).toBe(true)
    expect(isOwnExtension('moz-extension://3f2a0c7e-aaaa-bbbb-cccc-123456789abc', id)).toBe(true)
  })
  it('does not accept any other add-on, web page or empty origin', () => {
    expect(isOwnExtension('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', id)).toBe(false)
    expect(isOwnExtension('https://evil.example', id)).toBe(false)
    expect(isOwnExtension('', id)).toBe(false)
    expect(isOwnExtension(`chrome-extension://${id}.evil`, id)).toBe(false)
  })
  it('manifest carries the key and the alarms permission (retry while the app is off)', () => {
    expect(manifest.key).toBeTruthy()
    expect(manifest.permissions).toContain('alarms')
  })
})
