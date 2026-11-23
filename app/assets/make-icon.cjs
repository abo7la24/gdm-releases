// Draws our own logo (a squarish white letter G on a violet rounded square) at every size we need.
// No external art. Run: node assets/make-icon.cjs
// Writes: icon.png (256), tray.png (32), icon.ico (16-256), sidebar.bmp + header.bmp (installer pages),
//         ../public/logo.png (shown inside the app windows).
const fs = require('fs')
const zlib = require('zlib')
const path = require('path')

const VIOLET = [0x6b, 0x46, 0xc1]
const WHITE = [255, 255, 255]

// Shapes live in a 256x256 design space.
const inTile = (x, y) => {
  const r = 52
  const cx = Math.min(Math.max(x, r), 255 - r)
  const cy = Math.min(Math.max(y, r), 255 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
const inG = (x, y) => {
  const dx = x - 128
  const dy = 128 - y
  const r = Math.pow(Math.abs(dx) ** 4 + Math.abs(dy) ** 4, 0.25) // squarish ring, not a circle
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI
  const ring = r >= 52 && r <= 92 && !(deg > 8 && deg < 42)
  const bar = x >= 132 && x <= 220 && y >= 118 && y <= 144
  return ring || bar
}

// colour at a design-space point for the tile logo: [r,g,b,a]
const tilePixel = (x, y) => (!inTile(x, y) ? [0, 0, 0, 0] : [...(inG(x, y) ? WHITE : VIOLET), 255])

// supersampled render of any function over a w x h pixel grid; f(px, py) returns [r,g,b,a] in pixel space
function render(w, h, f) {
  const out = Buffer.alloc(w * h * 4)
  const S = 3
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const c = f(x + (i + 0.5) / S, y + (j + 0.5) / S)
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]
        }
      }
      const o = (y * w + x) * 4
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a }
      out[o + 3] = a / (S * S)
    }
  }
  return out
}

const squareLogo = (n) => render(n, n, (x, y) => tilePixel((x / n) * 256, (y / n) * 256))

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (b) => {
  let c = 0xffffffff
  for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
function png(n, rgba) {
  const raw = Buffer.alloc((n * 4 + 1) * n)
  for (let y = 0; y < n; y++) rgba.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ICO with PNG payloads (Windows Vista and later)
function ico(sizes) {
  const imgs = sizes.map((n) => png(n, squareLogo(n)))
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4)
  let offset = 6 + 16 * sizes.length
  const dir = sizes.map((n, i) => {
    const e = Buffer.alloc(16)
    e[0] = n === 256 ? 0 : n; e[1] = n === 256 ? 0 : n
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
    e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(offset, 12)
    offset += imgs[i].length
    return e
  })
  return Buffer.concat([head, ...dir, ...imgs])
}

// 24-bit BMP (what the NSIS installer pages need), composited over a solid background
function bmp(w, h, f) {
  const rgba = render(w, h, f)
  const rowSize = Math.ceil((w * 3) / 4) * 4
  const data = Buffer.alloc(rowSize * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const o = (h - 1 - y) * rowSize + x * 3
      data[o] = rgba[s + 2]; data[o + 1] = rgba[s + 1]; data[o + 2] = rgba[s]
    }
  }
  const head = Buffer.alloc(54)
  head.write('BM'); head.writeUInt32LE(54 + data.length, 2); head.writeUInt32LE(54, 10)
  head.writeUInt32LE(40, 14); head.writeInt32LE(w, 18); head.writeInt32LE(h, 22)
  head.writeUInt16LE(1, 26); head.writeUInt16LE(24, 28); head.writeUInt32LE(data.length, 34)
  return Buffer.concat([head, data])
}

const over = (bg, fg) => (fg[3] ? [fg[0], fg[1], fg[2], 255] : [...bg, 255])
const out = (f) => path.join(__dirname, f)

fs.writeFileSync(out('icon.png'), png(256, squareLogo(256)))
fs.writeFileSync(out('tray.png'), png(32, squareLogo(32)))
fs.writeFileSync(out('icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]))
fs.mkdirSync(path.join(__dirname, '..', 'public'), { recursive: true })
fs.writeFileSync(path.join(__dirname, '..', 'public', 'logo.png'), png(128, squareLogo(128)))

// Installer welcome/finish page side image, 164x314: violet panel with a big white G
fs.writeFileSync(out('sidebar.bmp'), bmp(164, 314, (x, y) => {
  const u = ((x - 82) / 120) * 256 + 128
  const v = ((y - 130) / 120) * 256 + 128
  return [...(inG(u, v) ? WHITE : VIOLET), 255]
}))
// Installer header image, 150x57: white strip with the logo tile at the right
fs.writeFileSync(out('header.bmp'), bmp(150, 57, (x, y) => over([255, 255, 255], tilePixel(((x - 94) / 48) * 256, ((y - 4) / 48) * 256))))
console.log('assets written')
