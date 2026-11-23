// Tries to start a real installed browser with the extension folder loaded, and reports whether it ran.
// Usage: node scripts/try-browser.mjs msedge|chrome
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const channel = process.argv[2] || 'msedge'
const ext = path.resolve('extension')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-try-'))
try {
  const ctx = await chromium.launchPersistentContext(tmp, {
    channel, headless: false, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  })
  await new Promise((r) => setTimeout(r, 3000))
  const sw = ctx.serviceWorkers()
  console.log(`${channel}: started, extension service workers: ${sw.length}`, sw.map((s) => s.url()).join(' '))
  const page = await ctx.newPage()
  await page.goto(`${channel === 'msedge' ? 'edge' : 'chrome'}://extensions`)
  console.log('extensions page text:', (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 120).replace(/\n/g, ' '))
  await ctx.close()
} catch (e) {
  console.log(`${channel}: could not start: ${String(e.message).split('\n')[0]}`)
}
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* temp */ }
