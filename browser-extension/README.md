# Openline — Seller Note Fetcher (Chrome/Edge extension)

On-demand fetch of a Seller Central order's **Seller Note** using your **already-logged-in**
Seller Central session. No passwords or cookies are stored anywhere.

## How it works
1. You enter an Amazon Order ID (or open the extension while viewing an order — it auto-fills).
2. The extension opens that order's page in a **hidden background tab**, which renders as *you*
   (your live Seller Central login).
3. It scrapes the Seller Note from the rendered page, then **closes the tab**.
4. The note shows in the popup with a **Copy** button.

It only ever touches `sellercentral.amazon.com`, one order at a time, when you click — no bulk crawling.

## Install (unpacked)
1. Chrome/Edge → `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. **Load unpacked** → select this `browser-extension/` folder.
4. Pin the extension. Make sure you're **logged into Seller Central** in the same browser.

## Finalizing the note selector
Seller Central's DOM isn't documented, so the first version auto-detects the note by looking
for a "Note"/"Seller note" label and reading the adjacent value. If auto-detect misses (or grabs
the wrong text), the popup lists candidate strings.

To make it exact:
1. On a Seller Central order page, right-click the note → **Inspect**.
2. Copy a CSS selector that targets the note's text element.
3. Paste it into the extension popup under **Advanced: note CSS selector** (saved for next time).

Share that selector (or the note element's HTML) and it can be baked in as the default.

## Notes / caveats
- Automated access to Seller Central is discouraged by Amazon; keep it light (single, on-demand
  lookups) to avoid tripping bot detection.
- If the note never appears, the order page markup may have changed — update the selector.
