const $ = (id) => document.getElementById(id)
const orderInput = $('orderId')
const selectorInput = $('selector')
const goBtn = $('go')
const result = $('result')

// Prefill: order id from the active tab if it's a Seller Central order page.
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const url = tabs && tabs[0] && tabs[0].url
  const m = url && url.match(/orders?-v\d\/order\/([0-9-]+)/)
  if (m) orderInput.value = m[1]
})

// Load + persist the saved selector.
chrome.storage.local.get('noteSelector').then(({ noteSelector }) => {
  if (noteSelector) selectorInput.value = noteSelector
})
selectorInput.addEventListener('change', () => {
  chrome.storage.local.set({ noteSelector: selectorInput.value.trim() || null })
})

function render(html) { result.innerHTML = html }

async function fetchNote() {
  const orderId = orderInput.value.trim()
  if (!orderId) { render('<div class="err">Enter an order ID.</div>'); return }
  goBtn.disabled = true
  render('<div class="muted">Opening the order in the background…</div>')
  try {
    const res = await chrome.runtime.sendMessage({ action: 'fetchSellerNote', orderId })
    if (res && res.ok) {
      render(`
        <label>Seller Note</label>
        <div class="note" id="noteText"></div>
        <button class="copy" id="copyBtn">Copy</button>
      `)
      $('noteText').textContent = res.note
      $('copyBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(res.note)
        $('copyBtn').textContent = 'Copied ✓'
      })
    } else {
      const cands = (res && res.candidates) || []
      render(`
        <div class="err">${(res && res.error) || 'Failed.'}</div>
        ${cands.length ? '<div class="cands"><div class="muted">Possible matches (click to set as the note selector target):</div>' +
          cands.map((c) => `<div class="cand">${c.replace(/</g, '&lt;')}</div>`).join('') + '</div>' : ''}
      `)
    }
  } catch (e) {
    render(`<div class="err">${e && e.message ? e.message : 'Extension error.'}</div>`)
  } finally {
    goBtn.disabled = false
  }
}

goBtn.addEventListener('click', fetchNote)
orderInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchNote() })
