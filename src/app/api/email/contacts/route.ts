/**
 * GET /api/email/contacts?accountId= — recent correspondents for compose autocomplete.
 * Derived from recent Sent (To/Cc) and Inbox (From) messages. No extra scope needed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { listMessages, getMessage, listPeopleContacts, pMap } from '@/lib/email/google'
import { canUseMailAccount } from '@/lib/email/access'

export const dynamic = 'force-dynamic'

interface Header { name: string; value: string }
function header(headers: Header[] | undefined, name: string): string {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}
// Parse "Name <a@b.com>, Other <c@d.com>" into { name, email } entries.
function parseAddrs(raw: string): { name: string; email: string }[] {
  const out: { name: string; email: string }[] = []
  const re = /(?:"?([^"<>,]*?)"?\s*)?<?([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})>?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const email = m[2].trim().toLowerCase()
    const name = (m[1] || '').trim()
    if (email) out.push({ name: name && name.toLowerCase() !== email ? name : '', email })
  }
  return out
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const accountId = req.nextUrl.searchParams.get('accountId')
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  if (!(await canUseMailAccount(accountId, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const byEmail = new Map<string, { name: string; email: string }>()
    const add = (a: { name: string; email: string }) => {
      if (!a.email) return
      const existing = byEmail.get(a.email)
      if (!existing || (!existing.name && a.name)) byEmail.set(a.email, a)
    }

    // Primary source: Google contacts + auto-saved "other contacts" (People API).
    // Requires the contacts scopes — reconnect the mailbox if it was linked
    // before those were added. Falls back to the recent-message scan below.
    let peopleError: string | null = null
    let peopleCount = 0
    try {
      const { contacts: people, errors } = await listPeopleContacts(accountId)
      peopleCount = people.length
      people.forEach(add)
      if (errors.length) { peopleError = errors[0]; console.error('[email/contacts] People API errors:', errors) }
    } catch (e) {
      peopleError = e instanceof Error ? e.message : String(e)
      console.error('[email/contacts] People API failed:', peopleError)
    }

    const [sent, inbox] = await Promise.all([
      listMessages(accountId, { labelIds: ['SENT'], maxResults: 30 }),
      listMessages(accountId, { labelIds: ['INBOX'], maxResults: 20 }),
    ])
    const scan: { id: string; from: boolean }[] = [
      ...(sent.messages ?? []).map(m => ({ id: m.id, from: false })),
      ...(inbox.messages ?? []).map(m => ({ id: m.id, from: true })),
    ]
    // Throttled — Gmail rejects too many concurrent per-user requests.
    await pMap(scan, async ({ id, from }) => {
      const m = await getMessage(accountId, id, 'metadata') as { payload?: { headers?: Header[] } }
      if (from) {
        parseAddrs(header(m.payload?.headers, 'From')).forEach(add)
      } else {
        parseAddrs(header(m.payload?.headers, 'To')).forEach(add)
        parseAddrs(header(m.payload?.headers, 'Cc')).forEach(add)
      }
    }, 4)

    // Named contacts first, then the rest — capped for a responsive datalist.
    const contacts = Array.from(byEmail.values())
      .sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || a.email.localeCompare(b.email))
      .slice(0, 2000)
    return NextResponse.json({ contacts, peopleCount, peopleError, total: contacts.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load contacts', contacts: [] }, { status: 200 })
  }
}
