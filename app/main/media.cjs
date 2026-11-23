// Videos and audio from web pages (YouTube, Vimeo, Facebook, X, TikTok, news sites, streams...), through yt-dlp.
// yt-dlp reads the page and lists every quality; GDM shows that list, then asks yt-dlp to fetch the choice.
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const sizeOf = (f, duration) => f.filesize || f.filesize_approx || (f.tbr && duration ? Math.round(((f.tbr * 1000) / 8) * duration) : null)
const hasVideo = (f) => f.vcodec && f.vcodec !== 'none'
const hasAudio = (f) => f.acodec && f.acodec !== 'none'

// yt-dlp's description of a page -> what the user can choose.
function buildOptions(info) {
  if (info?._type === 'playlist') throw new Error('This page is a list of videos. Open one video and try again.')
  const duration = info.duration || null
  const formats = (info.formats || []).filter((f) => f && f.format_id && !/storyboard|mhtml/i.test(f.format_id + (f.ext || '')))
  const audioOnly = formats.filter((f) => hasAudio(f) && !hasVideo(f))
  const audioRank = (f) => (f.abr || f.tbr || 0) + (f.ext === 'm4a' ? 40 : 0) // M4A plays almost everywhere, so it wins a close call
  const bestAudio = [...audioOnly].sort((a, b) => audioRank(b) - audioRank(a))[0]

  const byHeight = new Map()
  for (const f of formats.filter((x) => hasVideo(x) && x.height)) {
    if (!byHeight.has(f.height)) byHeight.set(f.height, [])
    byHeight.get(f.height).push(f)
  }
  const video = [...byHeight.entries()].sort((a, b) => b[0] - a[0]).map(([height, list]) => {
    const rank = (f) => (f.tbr || 0) + (/^(avc|h264)/i.test(f.vcodec || '') ? 0.5 : 0) // prefer the widely playable codec
    const progressive = list.filter(hasAudio).sort((a, b) => rank(b) - rank(a))[0]
    const bestV = [...list].sort((a, b) => rank(b) - rank(a))[0]
    const fps = Math.max(...list.map((f) => f.fps || 0))
    let size = null
    if (progressive) size = sizeOf(progressive, duration)
    else { const v = sizeOf(bestV, duration); const a = bestAudio ? sizeOf(bestAudio, duration) : 0; size = v ? v + (a || 0) : null }
    return { height, fps: fps > 30 ? Math.round(fps) : 0, ext: progressive ? progressive.ext : 'mp4', size, needsFfmpeg: !progressive }
  })

  const audio = []
  if (bestAudio) audio.push({ id: 'original', ext: bestAudio.ext, abr: Math.round(bestAudio.abr || 0) || null, size: sizeOf(bestAudio, duration), needsFfmpeg: false })
  if (bestAudio || video.length) audio.push({ id: 'mp3', ext: 'mp3', abr: null, size: bestAudio ? sizeOf(bestAudio, duration) : null, needsFfmpeg: true })

  if (!video.length && !audio.length) throw new Error('No video was found on this page.')
  return {
    title: String(info.title || info.id || 'video'),
    uploader: info.uploader || info.channel || '',
    site: info.extractor_key || info.extractor || '',
    duration,
    thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.at(-1)?.url) || null,
    isLive: !!info.is_live,
    video,
    audio,
  }
}

// The arguments for one download. A list, never a command line text, so nothing in a link or a title can run as a command.
function buildDownloadArgs({ url, headers = {}, media, outDir, baseName, ffmpegPath }) {
  const a = [
    '--no-playlist', '--no-warnings', '--newline', '--no-colors', '--windows-filenames', '--no-mtime', '--socket-timeout', '20',
    '-P', outDir, '-o', `${String(baseName).replace(/%/g, '%%')}.%(ext)s`,
    '--progress-template', 'download:GDM %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s',
  ]
  for (const [k, v] of Object.entries(headers)) if (v) a.push('--add-header', `${k}:${v}`)
  if (ffmpegPath) a.push('--ffmpeg-location', ffmpegPath)
  if (media.kind === 'audio') {
    if (media.format === 'mp3') a.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0')
    else a.push('-f', 'bestaudio[ext=m4a]/bestaudio/best')
  } else {
    const h = Number.isInteger(media.height) && media.height > 0 ? media.height : 0
    if (ffmpegPath) {
      // the best picture up to the chosen height with the best sound, joined into one file; the widely playable codecs first
      const cap = h ? `[height<=${h}]` : ''
      a.push('-f', `bestvideo${cap}[ext=mp4]+bestaudio[ext=m4a]/bestvideo${cap}+bestaudio/best${cap}/best`, '--merge-output-format', 'mp4')
    } else {
      a.push('-f', h ? `best[height<=${h}]/best` : 'best') // without the helper only ready-made single files can be fetched
    }
  }
  a.push('--', url)
  return a
}

function parseProgress(line) {
  const m = /^GDM (\S+) (\S+) (\S+) (\S+)/.exec(line)
  if (!m) return null
  const n = (v) => (v === 'NA' || v === 'None' || v === 'nan' ? null : Number(v))
  return { downloaded: n(m[1]), total: n(m[2]) ?? n(m[3]), speed: n(m[4]) }
}

// Where yt-dlp says it is writing, so we know the final file when it is done.
function parseDestination(line) {
  let m = /^\[Merger\] Merging formats into "(.+)"$/.exec(line)
  if (m) return { path: m[1], final: true }
  m = /^\[ExtractAudio\] Destination: (.+)$/.exec(line)
  if (m) return { path: m[1], final: true }
  m = /^\[(?:download|Fixup\w*|VideoRemuxer)\] Destination: (.+)$/.exec(line)
  if (m) return { path: m[1], final: false }
  m = /^\[download\] (.+) has already been downloaded$/.exec(line)
  if (m) return { path: m[1], final: true }
  return null
}

// yt-dlp complaints in plain words (English here, translated where they are shown).
function friendlyMediaError(text) {
  const s = String(text || '')
  if (/Unsupported URL/i.test(s)) return 'No video was found on this page.'
  if (/DRM/i.test(s)) return 'This video is protected (DRM) and cannot be downloaded.'
  if (/sign in|log ?in|login required|members.only|private video|premium|subscri|age.restricted|confirm your age/i.test(s)) return 'This video needs you to be signed in. Start it from the browser add-on so your session is used.'
  if (/unavailable|removed|not available in your country|geo.?restrict|blocked it|copyright/i.test(s)) return 'This video is not available.'
  if (/HTTP Error 40[13]/i.test(s)) return 'This video is not available.'
  if (/HTTP Error 429|Too Many Requests/i.test(s)) return 'The site is limiting requests. Try again later.'
  if (/ffmpeg|ffprobe/i.test(s) && /not found|not installed|no such file/i.test(s)) return 'The conversion helper is missing.'
  if (/getaddrinfo|Network is unreachable|timed out|Unable to download|Connection reset|urlopen error/i.test(s)) return 'Could not reach the server.'
  return 'The video could not be downloaded.'
}

function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
  else child.kill('SIGKILL')
}

function lines(stream, onLine) {
  let buf = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1) }
  })
  stream.on('end', () => { if (buf) onLine(buf.replace(/\r$/, '')) })
}

function run(cmd, args, env, signal) {
  return spawn(cmd, args, { env: { ...process.env, ...env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal })
}

// Reads the page and returns what can be chosen. Gives up after a minute.
function probeMedia(tools, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const cmd = tools.ytdlpCommand()
    if (!cmd) return reject(new Error('The video helper is not installed.'))
    const args = [...cmd.args, '-J', '--no-playlist', '--no-warnings', '--skip-download', '--socket-timeout', '20']
    for (const [k, v] of Object.entries(headers)) if (v) args.push('--add-header', `${k}:${v}`)
    args.push('--', url)
    const child = run(cmd.cmd, args, cmd.env)
    let out = ''
    let err = ''
    const timer = setTimeout(() => { killTree(child); reject(new Error('The server took too long to answer.')) }, 60000)
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d })
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(friendlyMediaError(err || out)))
      try { resolve(buildOptions(JSON.parse(out))) } catch (e) { reject(e.message && /^(This page|No video)/.test(e.message) ? e : new Error('The video could not be downloaded.')) }
    })
  })
}

// Files yt-dlp leaves while it works. Used to clean up after a cancel.
function partialFiles(dir, baseName) {
  try {
    return fs.readdirSync(dir).filter((f) => f.startsWith(baseName + '.') && /\.(part|ytdl|temp|f\d+\.\w+)$/i.test(f)).map((f) => path.join(dir, f))
  } catch { return [] }
}

// The job behind a "media" download: start yt-dlp, follow its progress, find the finished file.
async function runMedia(m, d, job) {
  const tools = m.tools
  if (!tools) throw new Error('The video helper is not installed.')
  const noteOff = () => { delete d.note }
  if (!tools.ytdlpCommand()) { d.note = 'Getting the video helper…'; m.emit('change'); await tools.ensureYtdlp(); noteOff() }
  if (d.media.needsFfmpeg && !tools.ffmpegPath()) {
    d.note = 'Getting the conversion helper…'; m.emit('change')
    await tools.ensureFfmpeg((p) => { d.note = 'Getting the conversion helper…'; d.noteProgress = p; m.emit('change') })
    noteOff(); delete d.noteProgress
  }
  if (job.abort.signal.aborted) return

  const outDir = path.dirname(d.save_path)
  fs.mkdirSync(outDir, { recursive: true })
  const cmd = tools.ytdlpCommand()
  const ffmpegPath = d.media.needsFfmpeg || d.media.kind === 'video' ? tools.ffmpegPath() : null
  const args = [...cmd.args, ...buildDownloadArgs({ url: d.url, headers: d.headers, media: d.media, outDir, baseName: d.media.baseName, ffmpegPath })]
  const child = run(cmd.cmd, args, cmd.env)
  job.child = child
  job.abort.signal.addEventListener('abort', () => killTree(child), { once: true })

  let base = 0 // bytes of the finished streams (video and sound are fetched one after the other)
  let last = 0
  let destination = null
  let finalDestination = null
  const tail = []
  const onLine = (line) => {
    if (!line) return
    const p = parseProgress(line)
    if (p) {
      const cur = p.downloaded ?? last
      if (cur < last - 1024) base += last // a new stream started
      job.bytes += Math.max(0, base + cur - (base + last))
      last = cur
      d.downloaded_bytes = base + cur
      if (p.total) d.size_bytes = Math.max(d.size_bytes || 0, base + p.total)
      if (d.size_bytes && d.downloaded_bytes > d.size_bytes) d.size_bytes = d.downloaded_bytes
      return
    }
    const dest = parseDestination(line)
    if (dest) { if (dest.final) finalDestination = dest.path; else destination = dest.path }
    tail.push(line)
    if (tail.length > 12) tail.shift()
  }
  lines(child.stdout, onLine)
  lines(child.stderr, onLine)

  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  if (job.abort.signal.aborted) return
  if (code !== 0) throw new Error(friendlyMediaError(tail.join('\n')))

  let finalPath = [finalDestination, destination].map((x) => x && (path.isAbsolute(x) ? x : path.join(outDir, x))).find((x) => x && fs.existsSync(x))
  if (!finalPath) { // fall back to looking for the finished file by name
    const found = fs.readdirSync(outDir).filter((f) => f.startsWith(d.media.baseName + '.') && !/\.(part|ytdl|temp)$/i.test(f) && !/\.f\d+\./.test(f))
    finalPath = found.length ? path.join(outDir, found[0]) : null
  }
  if (!finalPath) throw new Error('The video could not be downloaded.')
  d.save_path = finalPath
  d.file_name = path.basename(finalPath)
  d.size_bytes = d.downloaded_bytes = fs.statSync(finalPath).size
  await m.finishMedia(d)
}

module.exports = { buildOptions, buildDownloadArgs, parseProgress, parseDestination, friendlyMediaError, probeMedia, runMedia, partialFiles, killTree }
