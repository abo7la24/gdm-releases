// Publishes a new GDM version so that installed copies update themselves, in one command:
//
//   npm run release -- --repo YOUR-NAME/YOUR-REPO --en "What is new" --fr "..." --ar "..."
//
// It sets the update address, builds the installer, prepares latest.json and creates a GitHub release with both files.
// Needs the GitHub command line tool, signed in once:  winget install GitHub.cli   then   gh auth login
// Add --dry-run to do everything except publish (the update address in package.json is put back afterwards).
// Before each release, raise "version" in package.json: GDM only updates to a higher number.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined }
const flag = (name) => process.argv.includes(`--${name}`)
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npx', ...opts })
const fail = (msg) => { console.error(msg); process.exit(1) }

const repo = arg('repo')
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('Say which repository: --repo YOUR-NAME/YOUR-REPO (it must be public, so installed copies can read it).')
const dry = flag('dry-run')
const pkgFile = 'package.json'
const original = fs.readFileSync(pkgFile, 'utf8')
const pkg = JSON.parse(original)
const tag = `v${pkg.version}`

if (!dry) {
  const gh = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', shell: true })
  if (gh.status !== 0) fail('The GitHub tool is not installed or not signed in. Run:  winget install GitHub.cli   then   gh auth login')
  const exists = spawnSync('gh', ['release', 'view', tag, '--repo', repo], { encoding: 'utf8', shell: true })
  if (exists.status === 0) fail(`Release ${tag} already exists. Raise "version" in package.json first.`)
}

// the address every installed copy will look at: always the newest release of this repository
const feed = `https://github.com/${repo}/releases/latest/download/latest.json`
try {
  if (pkg.gdmUpdateUrl !== feed) { pkg.gdmUpdateUrl = feed; fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2)) }
  console.log(`Update address: ${feed}\nBuilding ${tag}...`)
  if (run('npx', ['vite', 'build']).status !== 0) fail('The build failed.')
  if (run('npx', ['electron-builder', '--win', 'nsis'], { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } }).status !== 0) fail('Packing the installer failed.')
  const notes = ['en', 'fr', 'ar'].flatMap((l) => (arg(l) ? [`--${l}`, arg(l)] : []))
  if (run('node', ['scripts/make-update.mjs', '--base', `https://github.com/${repo}/releases/latest/download/`, ...notes]).status !== 0) fail('Preparing latest.json failed.')
  const files = fs.readdirSync(path.join('release', 'update')).map((f) => path.join('release', 'update', f))
  const title = `GDM ${pkg.version}`
  const text = arg('en') || `GDM ${pkg.version}`
  if (dry) {
    console.log(`\nDry run: nothing was published. It would have run:\n  gh release create ${tag} ${files.join(' ')} --repo ${repo} --title "${title}" --notes "${text}"`)
  } else {
    const r = spawnSync('gh', ['release', 'create', tag, ...files, '--repo', repo, '--title', title, '--notes', text, '--latest'], { stdio: 'inherit', shell: true })
    if (r.status !== 0) fail('Publishing failed.')
    console.log(`\nPublished ${tag}. Copies of GDM that have the address above will find it within a day, or when they press "Check for updates now".`)
  }
} finally {
  if (dry) fs.writeFileSync(pkgFile, original) // a dry run leaves no trace in package.json
}
