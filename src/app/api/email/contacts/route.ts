/**
 * GET /api/email/contacts?accountId= — recent correspondents for compose autocomplete.
 * Derived from recent Sent (To/Cc) and Inbox (From) messages. No extra scope needed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { listMessages, getMessage } from '@/lib/email/google'
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
    const [sent, inbox] = await Promise.all([
      listMessages(accountId, { labelIds: ['SENT'], maxResults: 30 }),
      listMessages(accountId, { labelIds: ['INBOX'], maxResults: 20 }),
    ])
    const sentIds = (sent.messages ?? []).map(m => m.id)
    const inboxIds = (inbox.messages ?? []).map(m => m.id)

    const byEmail = new Map<string, { name: string; email: string }>()
    const add = (a: { name: string; email: string }) => {
      const existing = byEmail.get(a.email)
      if (!existing || (!existing.name && a.name)) byEmail.set(a.email, a)
    }

    await Promise.all([
      ...sentIds.map(async id => {
        const m = await getMessage(accountId, id, 'metadata') as { payload?: { headers?: Header[] } }
        parseAddrs(header(m.payload?.headers, 'To')).forEach(add)
        parseAddrs(header(m.payload?.headers, 'Cc')).forEach(add)
      }),
      ...inboxIds.map(async id => {
        const m = await getMessage(accountId, id, 'metadata') as { payload?: { headers?: Header[] } }
        parseAddrs(header(m.payload?.headers, 'From')).forEach(add)
      }),
    ])

    const contacts = Array.from(byEmail.values()).sort((a, b) => a.email.localeCompare(b.email))
    return NextResponse.json({ contacts })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load contacts', contacts: [] }, { status: 200 })
  }
}
