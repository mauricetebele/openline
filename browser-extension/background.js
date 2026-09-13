// Service worker: opens a Seller Central order page in a background tab (rendered
// with the user's live session), scrapes the Seller Note, then closes the tab.
// No credentials stored — it reuses the browser's existing Seller Central login.

const ORDER_URL = (orderId) =>
  `https://sellercentral.amazon.com/orders-v3/order/${encodeURIComponent(orderId)}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Runs INSIDE the order page. Finds the Seller Note by (1) a saved CSS selector,
 *  else (2) a label heuristic ("Note"/"Seller note" → adjacent value). Also returns
 *  candidate strings so the selector can be tuned. Must be self-contained. */
function extractNoteInPage(customSelector) {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()

  if (customSelector) {
    try {
      const el = document.querySelector(customSelector)
      if (el) { const v = clean(el.textContent); if (v) return { note: v, candidates: [] } }
    } catch { /* bad selector — fall through to heuristic */ }
  }

  const labelRe = /^(seller\s+)?notes?:?$/i
  const candidates = []
  const els = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,dt,label,span,div,strong,b,p'))
  for (const el of els) {
    const t = clean(el.textContent)
    if (!labelRe.test(t)) continue
    const val =
      clean(el.nextElementSibling && el.nextElementSibling.textContent) ||
      clean(el.parentElement && el.parentElement.querySelector('dd, p, textarea') && el.parentElement.querySelector('dd, p, textarea').textContent)
    if (val && val.length > 0 && val.length < 500 && !labelRe.test(val)) candidates.push(val)
  }
  // De-dupe, keep short-ish distinct strings.
  const seen = new Set()
  const uniq = candidates.filter((c) => (seen.has(c) ? false : seen.add(c)))
  return { note: uniq[0] || null, candidates: uniq.slice(0, 10) }
}

function waitForComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); resolve() }
    const to = setTimeout(done, timeoutMs)
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') { clearTimeout(to); done() }
    }
    chrome.tabs.onUpdated.addListener(listener)
    // In case it already completed before we attached.
    chrome.tabs.get(tabId, (t) => { if (t && t.status === 'complete') { clearTimeout(to); done() } })
  })
}

async function fetchSellerNote(orderId) {
  const { noteSelector } = await chrome.storage.local.get('noteSelector')
  const tab = await chrome.tabs.create({ url: ORDER_URL(orderId), active: false })
  try {
    await waitForComplete(tab.id)
    // The order page is a SPA — the note renders after load, so poll the extractor.
    const deadline = Date.now() + 25000
    let last = { note: null, candidates: [] }
    while (Date.now() < deadline) {
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, func: extractNoteInPage, args: [noteSelector || null],
        })
        last = (res && res[0] && res[0].result) || last
        if (last && last.note) return { ok: true, note: last.note }
      } catch { /* page not ready / navigating — retry */ }
      await sleep(1200)
    }
    return { ok: false, error: 'Seller Note not found on the order page.', candidates: last.candidates || [] }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Failed to load order page.' }
  } finally {
    try { await chrome.tabs.remove(tab.id) } catch { /* already closed */ }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.action === 'fetchSellerNote' && msg.orderId) {
    fetchSellerNote(String(msg.orderId).trim()).then(sendResponse)
    return true // async response
  }
})
