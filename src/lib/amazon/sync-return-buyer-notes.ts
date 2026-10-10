/**
 * Pulls the buyer's free-text note ("Customer's Comment") out of Amazon
 * "Return authorization notification" emails and writes it onto the matching
 * MFNReturn rows, so it surfaces on the order view next to the return reason.
 *
 * Amazon's MFN returns flat-file report usually leaves the customer-comment
 * column blank, so the notification email is the only reliable source.
 *
 * Mailbox: amazonrefunds@openline.us (override via EMAIL_RETURNS_MAILBOX).
 */
import { prisma } from '@/lib/prisma'
import { listMessages, getMessage, batchModify, pMap } from '@/lib/email/google'
import { parseReturnEmail, type ParsedReturnEmail, type ReturnEmailItem } from './parse-return-email'

export const RETURNS_MAILBOX = process.env.EMAIL_RETURNS_MAILBOX || 'amazonrefunds@openline.us'

interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] }
interface GmailFullMessage { payload?: GmailPart & { headers?: { name: string; value: string }[] } }

function decodeB64Url(data?: string): string {
  return data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : ''
}

function extractBody(msg: GmailFullMessage): { subject: string | null; html: string } {
  const headers = msg.payload?.headers ?? []
  const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value ?? null
  const parts: { mime: string; text: string }[] = []
  const walk = (p?: GmailPart): void => {
    if (!p) return
    if (p.body?.data) parts.push({ mime: p.mimeType ?? '', text: decodeB64Url(p.body.data) })
    ;(p.parts ?? []).forEach(walk)
  }
  walk(msg.payload)
  const html = parts.find(p => p.mime === 'text/html')?.text
    ?? parts.find(p => p.mime === 'text/plain')?.text
    ?? ''
  return { subject, html }
}

/** Pick the email item whose ASIN matches the return row (falls back to the sole/first item). */
function pickItem(parsed: ParsedReturnEmail, asin: string | null): ReturnEmailItem | null {
  if (!parsed.items.length) return null
  if (asin) {
    const hit = parsed.items.find(i => i.asin && i.asin.toLowerCase() === asin.toLowerCase())
    if (hit) return hit
  }
  if (parsed.items.length === 1) return parsed.items[0]
  // Multiple items, no ASIN match — prefer the first with a comment.
  return parsed.items.find(i => i.buyerComment) ?? parsed.items[0]
}

export interface SyncBuyerNotesResult {
  ok: boolean
  reason?: string
  emailsScanned: number
  ordersWithComment: number
  returnsMatched: number
  returnsUpdated: number
  emailsArchived: number
  unmatchedOrderIds: string[]
}

/**
 * @param opts.newerThanDays  limit the Gmail scan to the last N days
 * @param opts.orderIds       only update returns for these order ids (still scans the mailbox)
 * @param opts.onlyMissing    skip returns that already have a buyerComment (default false — refresh all)
 * @param opts.maxEmails      safety cap on emails scanned (default 3000)
 * @param opts.search         extra Gmail search terms (e.g. a quoted order id for a targeted pull)
 * @param opts.archive        archive (remove INBOX) emails whose buyer comment is now stored on
 *                            its return (default true). Emails with no comment, or whose return
 *                            isn't in mfn_returns yet, stay in the inbox for a later sync.
 */
export async function syncReturnBuyerNotes(opts: {
  newerThanDays?: number
  orderIds?: string[]
  onlyMissing?: boolean
  maxEmails?: number
  search?: string
  archive?: boolean
} = {}): Promise<SyncBuyerNotesResult> {
  const empty: SyncBuyerNotesResult = { ok: false, emailsScanned: 0, ordersWithComment: 0, returnsMatched: 0, returnsUpdated: 0, emailsArchived: 0, unmatchedOrderIds: [] }

  const account = await prisma.emailAccount.findFirst({ where: { email: RETURNS_MAILBOX } })
  if (!account) return { ...empty, reason: `Returns mailbox ${RETURNS_MAILBOX} is not connected` }
  if (!account.active || !account.refreshTokenEnc) return { ...empty, reason: `Returns mailbox ${RETURNS_MAILBOX} needs to be reconnected` }

  // Build the Gmail query.
  let q = 'subject:"Return authorization notification"'
  if (opts.newerThanDays && opts.newerThanDays > 0) q += ` newer_than:${opts.newerThanDays}d`
  if (opts.search) q += ` ${opts.search}`

  // Collect message ids (paginated, newest first).
  const cap = opts.maxEmails ?? 3000
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const page = await listMessages(account.id, { q, maxResults: 100, pageToken })
    for (const m of page.messages ?? []) ids.push(m.id)
    pageToken = page.nextPageToken
  } while (pageToken && ids.length < cap)
  const scanIds = ids.slice(0, cap)

  // Fetch + parse. Gmail returns newest first, so the first email seen for an
  // order id is the most recent — we keep that one.
  const parsedList = await pMap(scanIds, async (id) => {
    try {
      const full = await getMessage(account.id, id, 'full') as GmailFullMessage
      const { subject, html } = extractBody(full)
      return { id, parsed: parseReturnEmail(subject, html) }
    } catch {
      return null
    }
  }, 5)

  const byOrder = new Map<string, ParsedReturnEmail>()
  const emailIdsByOrder = new Map<string, string[]>()
  for (const e of parsedList) {
    const p = e?.parsed
    if (!e || !p?.orderId) continue
    if (!byOrder.has(p.orderId)) byOrder.set(p.orderId, p)
    emailIdsByOrder.set(p.orderId, [...(emailIdsByOrder.get(p.orderId) ?? []), e.id])
  }
  const toArchive: string[] = []

  // Restrict to requested order ids, if any.
  const wantOrderIds = opts.orderIds?.length ? new Set(opts.orderIds) : null
  const ordersWithComment = Array.from(byOrder.values()).filter(p => p.items.some(i => i.buyerComment)).length

  let returnsMatched = 0
  let returnsUpdated = 0
  const unmatched: string[] = []

  for (const [orderId, parsed] of Array.from(byOrder.entries())) {
    if (wantOrderIds && !wantOrderIds.has(orderId)) continue
    if (!parsed.items.some(i => i.buyerComment)) continue

    const rows = await prisma.mFNReturn.findMany({
      where: { orderId, ...(opts.onlyMissing ? { buyerComment: null } : {}) },
      select: { id: true, asin: true, returnReason: true, buyerComment: true },
    })
    if (rows.length === 0) { unmatched.push(orderId); continue }

    let captured = false
    for (const row of rows) {
      const item = pickItem(parsed, row.asin)
      if (!item?.buyerComment) continue
      returnsMatched++
      captured = true
      const data: { buyerComment: string; returnReason?: string } = { buyerComment: item.buyerComment }
      if (!row.returnReason && item.returnReason) data.returnReason = item.returnReason
      // Skip no-op writes.
      if (row.buyerComment === data.buyerComment && data.returnReason === undefined) continue
      await prisma.mFNReturn.update({ where: { id: row.id }, data })
      returnsUpdated++
    }
    // Comment is stored on the return — this order's notification email(s) are done.
    if (captured) toArchive.push(...(emailIdsByOrder.get(orderId) ?? []))
  }

  // Archive = remove the INBOX label (email stays in All Mail). Best-effort.
  let emailsArchived = 0
  if (opts.archive !== false && toArchive.length > 0) {
    for (let i = 0; i < toArchive.length; i += 1000) {
      const chunk = toArchive.slice(i, i + 1000)
      try {
        await batchModify(account.id, chunk, undefined, ['INBOX'])
        emailsArchived += chunk.length
      } catch (err) {
        console.error('[buyer-notes] archive failed:', err instanceof Error ? err.message : err)
      }
    }
  }

  return {
    ok: true,
    emailsScanned: scanIds.length,
    ordersWithComment,
    returnsMatched,
    returnsUpdated,
    emailsArchived,
    unmatchedOrderIds: unmatched.slice(0, 100),
  }
}
