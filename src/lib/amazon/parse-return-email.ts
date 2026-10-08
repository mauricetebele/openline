/**
 * Parser for Amazon "Return authorization notification" seller emails.
 *
 * These notifications (sent to the seller's returns mailbox, e.g.
 * amazonrefunds@openline.us) carry the buyer's free-text note ("Customer's
 * Comment") which is frequently absent from the SP-API MFN returns report.
 * We parse the HTML body to recover it and attach it to the matching return.
 *
 * The email body has two relevant regions:
 *   1. A <ul> of <li><b>Label:</b> value</li> metadata (Order ID, Return
 *      Request Date, Return Policy Check, Authorization).
 *   2. A <table border="1"> with a header row (Order Item, ASIN, Sku, Return
 *      Quantity, Return Reason, Customer's Comment) and one data row per item.
 */

export interface ReturnEmailItem {
  title: string | null
  asin: string | null
  sku: string | null
  quantity: number | null
  returnReason: string | null
  buyerComment: string | null
}

export interface ParsedReturnEmail {
  orderId: string | null
  returnRequestDate: string | null
  returnPolicyCheck: string | null
  authorization: string | null
  returnCarrier: string | null
  trackingId: string | null
  items: ReturnEmailItem[]
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;|&#8217;|&#x2019;/gi, '’')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

/** Strip inner HTML tags from a table cell and normalise whitespace. */
function cellText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalise a header label to an alphanumeric key ("Customer's Comment" → "customerscomment"). */
function headerKey(s: string): string {
  return cellText(s).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function matchField(key: string): keyof ReturnEmailItem | null {
  if (key.includes('orderitem') || key === 'item') return 'title'
  if (key.includes('asin')) return 'asin'
  if (key.includes('sku')) return 'sku'
  if (key.includes('returnquantity') || key === 'quantity' || key === 'qty') return 'quantity'
  if (key.includes('returnreason')) return 'returnReason'
  if (key.includes('customer') && key.includes('comment')) return 'buyerComment'
  if (key.includes('buyercomment') || key.includes('comment')) return 'buyerComment'
  return null
}

/** Pull the "Label: value" pairs from the leading <li> metadata list. */
function parseMetadata(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi
  let m: RegExpExecArray | null
  while ((m = liRe.exec(html))) {
    const bold = /<b[^>]*>([\s\S]*?)<\/b>/i.exec(m[1])
    if (!bold) continue
    const label = headerKey(bold[1])
    const value = cellText(m[1].replace(bold[0], ''))
    if (label) out[label] = value
  }
  return out
}

/**
 * Parse a Return authorization notification email.
 * @param subject the email Subject header (used as a fallback for the order id)
 * @param htmlBody the HTML body of the email
 */
export function parseReturnEmail(subject: string | null | undefined, htmlBody: string): ParsedReturnEmail {
  const html = htmlBody ?? ''
  const meta = parseMetadata(html)

  // Order id: prefer the metadata <li>, fall back to the subject line.
  let orderId = meta['orderid'] || null
  if (!orderId && subject) {
    const sm = subject.match(/Order\s+([0-9]{3}-[0-9]{7}-[0-9]{7}|[A-Z0-9-]{8,})/i)
    if (sm) orderId = sm[1]
  }
  if (orderId) orderId = orderId.trim()

  // The summary table — the one with a visible border.
  const items: ReturnEmailItem[] = []
  const tableMatch = html.match(/<table[^>]*border=["']?1["']?[^>]*>([\s\S]*?)<\/table>/i)
  if (tableMatch) {
    const rows = tableMatch[1].match(/<tr[\s\S]*?<\/tr>/gi) ?? []
    let headerMap: (keyof ReturnEmailItem | null)[] | null = null
    for (const row of rows) {
      const isHeader = /<th[\s>]/i.test(row)
      const cells = (row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) ?? []).map(c =>
        c.replace(/^<t[hd][^>]*>/i, '').replace(/<\/t[hd]>$/i, ''),
      )
      if (isHeader) {
        headerMap = cells.map(c => matchField(headerKey(c)))
        continue
      }
      if (!headerMap) continue
      const item: ReturnEmailItem = { title: null, asin: null, sku: null, quantity: null, returnReason: null, buyerComment: null }
      cells.forEach((c, i) => {
        const field = headerMap![i]
        if (!field) return
        const val = cellText(c)
        if (field === 'quantity') item.quantity = val ? Number(val.replace(/[^0-9]/g, '')) || null : null
        else (item[field] as string | null) = val || null
      })
      // Skip empty filler rows.
      if (item.title || item.asin || item.sku || item.returnReason || item.buyerComment) items.push(item)
    }
  }

  // Carrier + tracking appear as plain labelled lines further down the body.
  const text = decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
  const carrier = text.match(/Return Shipping Carrier:\s*([A-Za-z0-9 ]+?)\s+Tracking ID:/i)?.[1]?.trim() || null
  const tracking = text.match(/Tracking ID:\s*([A-Za-z0-9]+)/i)?.[1]?.trim() || null

  return {
    orderId,
    returnRequestDate: meta['returnrequestdate'] || null,
    returnPolicyCheck: meta['returnpolicycheck'] || null,
    authorization: meta['authorization'] || null,
    returnCarrier: carrier,
    trackingId: tracking,
    items,
  }
}

/** True if this looks like a Return authorization notification (by subject). */
export function isReturnAuthorizationEmail(subject: string | null | undefined): boolean {
  return !!subject && /return\s+authorization\s+notification/i.test(subject)
}
