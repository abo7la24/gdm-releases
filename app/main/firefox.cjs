// Firefox cannot load the Chrome-style (MV3) manifest the same way, so the app builds a Firefox copy of the add-on:
// same scripts, a manifest version 2 file. (Firefox keeps full support for it, and gives the add-on its permissions at install.)
function toFirefoxManifest(chrome) {
  return {
    manifest_version: 2,
    name: chrome.name,
    version: chrome.version,
    description: chrome.description,
    browser_specific_settings: { gecko: { id: 'gdm-capture@gdm.local', strict_min_version: '115.0' } },
    permissions: [...new Set([...(chrome.permissions || []), ...(chrome.host_permissions || [])])],
    background: { scripts: ['background.js'] },
    browser_action: { default_popup: chrome.action?.default_popup || 'popup.html', default_title: chrome.action?.default_title || chrome.name },
  }
}

module.exports = { toFirefoxManifest }
