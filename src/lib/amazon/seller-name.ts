/**
 * Seller name resolution — fetches a seller's display name from public Amazon
 * pages and caches the result in the SellerProfile table.
 *
 * Tries three URL patterns in order; logs exactly what it finds at each step
 * so failures are visible in the server console.
 *
 * Null results are NOT cached permanently — they are retried on each call
 * until a name is successfully parsed.
 */
import axios from 'axios'
import { prisma } from '@/lib/prisma'

const MARKETPLACE_DOMAINS: Record<string, string> = {
  ATVPDKIKX0DER: 'amazon.com',
  A2EUQ1WTGCTBG2: 'amazon.ca',
  A1F83G8C2ARO7P: 'amazon.co.uk',
  A1PA6795UKMFR9: 'amazon.de',
  APJ6JRA9NG5V4:  'amazon.it',
  A13V1IB3VIYZZH: 'amazon.fr',
  A1RKKUPIHCS9HS: 'amazon.es',
  A1VC38T7YXB528: 'amazon.co.jp',
  A21TJRUUN4KGV:  'amazon.in',
  A2Q3Y263D00KWC: 'amazon.com.br',
  A1AM78C64UM0Y8: 'amazon.com.mx',
}

function amazonDomain(marketplaceId: string): string {
  return MARKETPLACE_DOMAINS[marketplaceId] ?? 'amazon.com'
}

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

function extractNameFromHtml(html: string, sellerId: string): string | null {
  // 1. Title: "Amazon.com Seller Profile: STORENAME"
  let m = html.match(/<title[^>]*>[^:]*Seller\s+Profile:\s*([^<|–\-]{2,80}?)(?:\s*[|–\-][^<]*)?\s*<\/title>/i)
  if (m?.[1]?.trim()) return m[1].trim()

  // 2. Title: "Amazon.com : STORENAME" (storefront search page)
  m = html.match(/<title[^>]*>Amazon\.[a-z.]+\s*:\s*([^<|–\-]{2,60}?)(?:\s*[|–\-]|\s*<)/i)
  if (m?.[1]?.trim()) {
    const candidate = m[1].trim()
    // Reject generic titles
    if (!candidate.match(/^(results|search|page|shop|online|shopping)/i)) return candidate
  }

  // 3. Embedded JSON — "storeName":"VALUE"
  m = html.match(/"storeName"\s*:\s*"([^"]{2,80})"/i)
    ?? html.match(/"merchantName"\s*:\s*"([^"]{2,80})"/i)
    ?? html.match(/"sellerDisplayName"\s*:\s*"([^"]{2,80})"/i)
    ?? html.match(/"businessName"\s*:\s*"([^"]{2,80})"/i)
  if (m?.[1]?.trim()) return m[1].trim()

  // 4. JSON-LD / state blob near the seller ID
  m = html.match(new RegExp(`"${sellerId}"[^{}]{0,200}"name"\\s*:\\s*"([^"]{2,80})"`, 'i'))
    ?? html.match(new RegExp(`"name"\\s*:\\s*"([^"]{2,80})"[^{}]{0,200}"${sellerId}"`, 'i'))
  if (m?.[1]?.trim()) return m[1].trim()

  // 5. data-seller-name / data-merchant-name attribute
  m = html.match(/data-seller-name="([^"]{2,80})"/i)
    ?? html.match(/data-merchant-name="([^"]{2,80})"/i)
  if (m?.[1]?.trim()) return m[1].trim()

  // 6. Visible seller name element (id or class)
  m = html.match(/id="sellerName"[^>]*>\s*([^<]{2,80})\s*</i)
    ?? html.match(/class="[^"]*seller[-_]?name[^"]*"[^>]*>\s*([^<]{2,80})\s*</i)
  if (m?.[1]?.trim()) return m[1].trim()

  return null
}

/**
 * Fetches the seller name from Amazon — tries three URL patterns in sequence.
 * Returns { name, url, snippet } so callers can log/debug what happened.
 */
export async function fetchSellerNameDebug(
  sellerId: string,
  marketplaceId: string,
): Promise<{ name: string | null; url: string; snippet: string; error?: string }> {
  const dom = amazonDomain(marketplaceId)
  const mid = marketplaceId

  const urls = [
    // Pattern 1 — "About this seller" (older static page, most parseable)
    `https://www.${dom}/gp/aag/main?ie=UTF8&seller=${sellerId}&marketplaceID=${mid}`,
    // Pattern 2 — Seller profile popup
    `https://www.${dom}/sp?seller=${sellerId}`,
    // Pattern 3 — Storefront search
    `https://www.${dom}/s?me=${sellerId}&marketplaceID=${mid}`,
  ]

  let lastError: string | undefined
  let lastUrl = urls[0]
  let lastSnippet = ''

  for (const url of urls) {
    lastUrl = url
    try {
      const resp = await axios.get<string>(url, {
        timeout: 15_000,
        maxRedirects: 5,
        headers: REQUEST_HEADERS,
      })
      const html: string = resp.data
      lastSnippet = html.slice(0, 800).replace(/\s+/g, ' ')
      const name = extractNameFromHtml(html, sellerId)
      console.log(`[SellerName] ${sellerId} @ ${url} → ${name ?? 'no match'} | snippet: ${lastSnippet.slice(0, 200)}`)
      if (name) return { name, url, snippet: lastSnippet }
      // No name found — try next URL
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[SellerName] ${sellerId} @ ${url} → ERROR: ${msg}`)
      lastError = msg
      // Continue to next URL instead of returning immediately
    }
  }

  return { name: null, url: lastUrl, snippet: lastSnippet, error: lastError }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Batch-resolves seller names. Checks the DB cache first; only fetches from
 * Amazon for IDs that don't have a confirmed name yet (null entries are
 * retried so transient failures don't permanently block resolution).
 */
export async function resolveSellerNames(
  sellerIds: string[],
  marketplaceId: string,
): Promise<Map<string, string | null>> {
  const unique = [...new Set(sellerIds)]
  const result = new Map<string, string | null>()

  // Only treat rows with an actual name as "done" — null rows are retried
  const cached = await prisma.sellerProfile.findMany({
    where: { sellerId: { in: unique }, name: { not: null } },
  })
  for (const row of cached) result.set(row.sellerId, row.name)

  const needsFetch = unique.filter((id) => !result.has(id))
  if (needsFetch.length === 0) return result

  console.log(`[SellerName] Resolving ${needsFetch.length} seller name(s)`)

  for (let i = 0; i < needsFetch.length; i++) {
    const sellerId = needsFetch[i]
    const { name } = await fetchSellerNameDebug(sellerId, marketplaceId)
    result.set(sellerId, name)

    // Only persist confirmed names; skip saving null so we retry next time
    if (name) {
      await prisma.sellerProfile.upsert({
        where: { sellerId },
        create: { sellerId, name },
        update: { name, fetchedAt: new Date() },
      })
    }

    if (i < needsFetch.length - 1) {
      await new Promise((r) => setTimeout(r, 1_200))
    }
  }

  return result
}
