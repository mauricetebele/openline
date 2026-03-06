/**
 * Patch qz-tray.js to handle undefined semver in versionCompare.
 * On some Windows setups, the version handshake fails silently
 * leaving connection.semver undefined, which crashes print().
 */
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'node_modules', 'qz-tray', 'qz-tray.js')

if (!fs.existsSync(file)) {
  console.log('[patch-qz-tray] qz-tray.js not found, skipping')
  process.exit(0)
}

let src = fs.readFileSync(file, 'utf-8')

const original = `            versionCompare: function(major, minor, patch, build) {
                if (_qz.tools.assertActive()) {
                    var semver = _qz.websocket.connection.semver;
                    if (semver[0] != major) {`

const patched = `            versionCompare: function(major, minor, patch, build) {
                if (_qz.tools.assertActive()) {
                    var semver = _qz.websocket.connection.semver;
                    if (!semver) { return 0; }
                    if (semver[0] != major) {`

if (src.includes('if (!semver) { return 0; }')) {
  console.log('[patch-qz-tray] Already patched')
  process.exit(0)
}

if (!src.includes(original)) {
  console.log('[patch-qz-tray] Could not find target code to patch')
  process.exit(0)
}

src = src.replace(original, patched)
fs.writeFileSync(file, src, 'utf-8')
console.log('[patch-qz-tray] Patched versionCompare to handle undefined semver')
