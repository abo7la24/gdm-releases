// Measures the built app: memory by process type and idle CPU, with the window open and after it is closed to the tray.
// Usage: node scripts/measure.mjs [path-to-exe]
import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const exe = path.resolve(process.argv[2] || 'release/win-unpacked/Genius Download Manager.exe')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-measure-'))
const app = await electron.launch({ executablePath: exe, args: exe.endsWith('electron.exe') ? ['.'] : [], env: { ...process.env, GDM_USERDATA: path.join(tmp, 'data') } })
const win = await app.firstWindow()
await win.getByRole('heading', { name: 'Nothing here yet' }).waitFor()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function snap(label) {
  await sleep(4000)
  const m1 = await app.evaluate(({ app: a }) => a.getAppMetrics())
  await sleep(5000)
  const m = await app.evaluate(({ app: a }) => a.getAppMetrics())
  const byType = {}
  let total = 0
  for (const p of m) {
    const mb = (p.memory.privateBytes ?? p.memory.workingSetSize) / 1024 // KB -> MB
    byType[p.type] = (byType[p.type] || 0) + mb
    total += mb
  }
  const cpu = m.reduce((s, p) => s + p.cpu.percentCPUUsage, 0)
  console.log(`${label}: ${m.length} processes, ${Math.round(total)} MB private memory, idle CPU ${cpu.toFixed(2)}%`)
  console.log('   ' + Object.entries(byType).map(([k, v]) => `${k} ${Math.round(v)} MB`).join(', '))
  return total
}

await snap('window open')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close()))
await snap('closed to tray')
const proc = app.process()
await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
if (proc.exitCode === null) await new Promise((r) => proc.once('exit', r))
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* temp folder */ }
