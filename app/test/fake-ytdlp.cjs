// A stand-in for yt-dlp, used by the tests so they need no internet and no real site.
// It understands the same arguments GDM sends, and records them in the file named by FAKE_YTDLP_LOG.
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const url = args[args.length - 1]
const log = (o) => process.env.FAKE_YTDLP_LOG && fs.appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(o) + '\n')
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const flag = (name) => args.includes(name)

if (flag('-J')) {
  log({ mode: 'probe', url, args })
  if (/unsupported/.test(url)) { console.error('ERROR: Unsupported URL: ' + url); process.exit(1) }
  if (/private/.test(url)) { console.error("ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video"); process.exit(1) }
  if (/playlist/.test(url)) { console.log(JSON.stringify({ _type: 'playlist', entries: [{ id: 'a' }] })); process.exit(0) }
  const thumb = process.env.FAKE_THUMB_URL || null
  console.log(JSON.stringify({
    id: 'abc123', title: 'Sample: the video / part 2', uploader: 'Some Channel', extractor_key: 'Youtube', duration: 120, thumbnail: thumb,
    formats: [
      { format_id: 'sb0', ext: 'mhtml', height: 90, vcodec: 'none', acodec: 'none' },
      { format_id: '137', ext: 'mp4', height: 1080, fps: 30, vcodec: 'avc1.640028', acodec: 'none', filesize: 30000000, tbr: 4000 },
      { format_id: '248', ext: 'webm', height: 1080, fps: 30, vcodec: 'vp9', acodec: 'none', filesize: 20000000, tbr: 2500 },
      { format_id: '299', ext: 'mp4', height: 1080, fps: 60, vcodec: 'avc1.64002a', acodec: 'none', filesize: 50000000, tbr: 7000 },
      { format_id: '22', ext: 'mp4', height: 720, fps: 30, vcodec: 'avc1.64001F', acodec: 'mp4a.40.2', filesize: 12000000, tbr: 1500 },
      { format_id: '136', ext: 'mp4', height: 720, fps: 30, vcodec: 'avc1.4d401f', acodec: 'none', filesize: 9000000, tbr: 1100 },
      { format_id: '18', ext: 'mp4', height: 360, fps: 30, vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', filesize: 4000000, tbr: 500 },
      { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128, filesize: 3000000 },
      { format_id: '251', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 160, filesize: 3500000 },
    ],
  }))
  process.exit(0)
}

if (flag('-U')) { log({ mode: 'update' }); console.log('yt-dlp is up to date'); process.exit(0) }
if (flag('--version')) { console.log('2099.01.01-fake'); process.exit(0) }

// ---- a download
log({ mode: 'download', url, args })
if (/fail-after/.test(url)) { console.error('ERROR: unable to download video data: HTTP Error 403: Forbidden'); process.exit(1) }

const outDir = opt('-P')
const template = opt('-o')
const base = template.replace(/\.%\(ext\)s$/, '').replace(/%%/g, '%')
const selector = opt('-f') || ''
const merging = selector.includes('+')
const audioOnly = /^bestaudio/.test(selector)
const mp3 = flag('--audio-format') && opt('--audio-format') === 'mp3'
const ext = mp3 ? 'mp3' : audioOnly ? 'm4a' : 'mp4'
const streams = merging ? [1500000, 500000] : [audioOnly ? 600000 : 2000000] // bytes per stream
const pattern = (offset, n) => Buffer.from(Array.from({ length: n }, (_, i) => (offset + i) % 251))
const CHUNK = 64 * 1024
const DELAY = Number(process.env.FAKE_YTDLP_DELAY || 30)

fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  let writtenTotal = 0
  for (let s = 0; s < streams.length; s++) {
    const total = streams[s]
    const part = path.join(outDir, `${base}.f${s}.${ext}.part`)
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0 // resumes where an earlier run stopped
    console.log(`[download] Destination: ${path.join(outDir, `${base}.f${s}.${ext}`)}`)
    while (have < total) {
      const n = Math.min(CHUNK, total - have)
      fs.appendFileSync(part, pattern(have, n))
      have += n
      console.log(`GDM ${have} ${total} NA 1000000`)
      await sleep(DELAY)
    }
    writtenTotal += total
  }
  const final = path.join(outDir, `${base}.${ext}`)
  const parts = streams.map((_, s) => path.join(outDir, `${base}.f${s}.${ext}.part`))
  fs.writeFileSync(final, Buffer.concat(parts.map((p) => fs.readFileSync(p))))
  for (const p of parts) fs.rmSync(p, { force: true })
  if (merging) console.log(`[Merger] Merging formats into "${final}"`)
  else if (mp3) console.log(`[ExtractAudio] Destination: ${final}`)
  else console.log(`[download] 100% of ${writtenTotal}`)
})()
