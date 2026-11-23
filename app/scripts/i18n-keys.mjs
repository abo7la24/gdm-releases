// Finds every English text that the windows show through t('...'), so a test can insist each one is translated.
// Usage: node scripts/i18n-keys.mjs   (prints the list)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function extractKeys() {
  const keys = new Set()
  const call = /\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
  for (const f of fs.readdirSync(path.join(root, 'src'))) {
    if (!/\.tsx?$/.test(f) || /^(i18n|lang-)/.test(f) || f.endsWith('.d.ts')) continue
    const text = fs.readFileSync(path.join(root, 'src', f), 'utf8')
    for (const m of text.matchAll(call)) keys.add(m[2].replace(/\\(['"`])/g, '$1').replace(/\\n/g, '\n'))
  }
  // texts the app names in English and the window words, listed in i18n.ts
  const i18n = fs.readFileSync(path.join(root, 'src', 'i18n.ts'), 'utf8')
  for (const block of i18n.matchAll(/export const KNOWN_(?:ERRORS|TEXT) = \[([\s\S]*?)\] as const/g)) {
    for (const m of block[1].matchAll(/'((?:\\.|[^'\\])*)'/g)) keys.add(m[1].replace(/\\'/g, "'"))
  }
  keys.add('The server replied {code}.')
  return [...keys].sort()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keys = extractKeys()
  fs.writeFileSync(path.join(root, 'keys.json'), JSON.stringify(keys, null, 1))
  console.log(keys.length, 'texts')
}
