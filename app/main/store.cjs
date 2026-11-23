const fs = require('fs')
const path = require('path')

// shortcut: one JSON file rewritten whole, fine for thousands of rows; move to SQLite (schema.sql) if history gets huge.
class Store {
  constructor(file) {
    this.file = file
    this.data = { downloads: {}, settings: {} }
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }
    } catch {
      /* first run or unreadable file: start empty */
    }
    this.timer = null
  }

  save() {
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 300) // not reset on every call, or constant changes would starve the write
  }

  flush() {
    clearTimeout(this.timer)
    this.timer = null
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.data))
    fs.renameSync(tmp, this.file) // atomic, so a crash never leaves half a file
  }
}

module.exports = { Store }
