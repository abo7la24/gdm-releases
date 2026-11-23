// Manual-test server: node test/slow-server.cjs  ->  http://127.0.0.1:8099/big.bin (60 MB, ~3 MB/s per connection, ranges ok)
const http = require('http')
const SIZE = 60 * 1024 * 1024
http.createServer((req, res) => {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
  const start = m ? Number(m[1]) : 0
  const end = m && m[2] ? Number(m[2]) : SIZE - 1
  res.writeHead(m ? 206 : 200, {
    'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ETag: '"big"',
    ...(m && { 'Content-Range': `bytes ${start}-${end}/${SIZE}` }),
  })
  let pos = start
  const pump = () => {
    if (res.destroyed || pos > end) return res.end()
    const n = Math.min(256 * 1024, end - pos + 1)
    res.write(Buffer.alloc(n, pos % 251))
    pos += n
    setTimeout(pump, 80)
  }
  pump()
}).listen(8099, '127.0.0.1', () => console.log('slow server on 8099'))
