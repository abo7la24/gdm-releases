// Prepares a release for the automatic updater: copies the built installer to release/update/ and writes latest.json next to it.
// Upload both files to any web address (GitHub Releases, your own server...). Then put the address of latest.json in
// package.json ("gdmUpdateUrl") before building, or in GDM: Settings, Updates.
//
//   npm run dist
//   node scripts/make-update.mjs --base https://example.com/gdm/ --en "Faster downloads" --fr "Téléchargements plus rapides" --ar "تنزيلات أسرع"
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined }
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const built = path.join('release', `${pkg.build.productName} Setup ${pkg.version}.exe`)
if (!fs.existsSync(built)) { console.error(`Build the installer first (npm run dist): ${built} was not found.`); process.exit(1) }

const base = arg('base') || ''
if (base && !/^https:\/\//i.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)/i.test(base)) { console.error('--base must start with https://'); process.exit(1) }
const name = `GDM-Setup-${pkg.version}.exe`
const out = path.join('release', 'update')
fs.mkdirSync(out, { recursive: true })
fs.copyFileSync(built, path.join(out, name))
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(built)).digest('hex')
const notes = Object.fromEntries(['en', 'fr', 'ar'].map((l) => [l, arg(l)]).filter(([, v]) => v))
const feed = { version: pkg.version, url: (base ? base.replace(/\/?$/, '/') : '') + name, sha256, ...(Object.keys(notes).length ? { notes } : {}) }
fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify(feed, null, 2))
console.log(`Ready in ${out}:\n  ${name}\n  latest.json\n`, JSON.stringify(feed, null, 2))
