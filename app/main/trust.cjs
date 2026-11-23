const crypto = require('crypto')

// Chrome-style browsers derive an add-on's id from its public key: the first 16 bytes of the SHA-256 hash,
// written with the letters a to p. Putting the key in the manifest makes our add-on's id the same on every computer.
function extensionIdFromKey(base64Key) {
  const hex = crypto.createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex').slice(0, 32)
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')
}

// Is this request from GDM's own add-on? Chrome, Edge and Brave: the id is fixed. Firefox gives each install a random
// address, so any Firefox add-on counts (it still needs the user to have installed it in their own browser).
function isOwnExtension(origin, id) {
  if (/^moz-extension:\/\//.test(origin)) return true
  return origin === `chrome-extension://${id}` || origin === `edge-extension://${id}`
}

module.exports = { extensionIdFromKey, isOwnExtension }
