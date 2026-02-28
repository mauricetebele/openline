// Empty stub — replaces Node.js-only packages (e.g. undici) in browser bundles.
// Firebase browser SDK uses native fetch; it never actually calls undici at runtime.
module.exports = {}
