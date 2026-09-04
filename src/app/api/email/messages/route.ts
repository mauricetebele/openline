/**
 * GET /api/email/messages?accountId=&labelIds=INBOX&q=&pageToken=
 * Lists message summaries (from/subject/snippet/date/unread) for the list pane.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { listMessages, getMessage } from '@/lib/email/google'

export const dynamic = 'force-dynamic'

interface Header { name: string; value: string }
function header(headers: Header[] | undefined, name: string): string {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const p = req.nextUrl.searchParams
  const accountId = p.get('accountId')
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  const labelIds = (p.get('labelIds') || 'INBOX').split(',').filter(Boolean)
  const q = p.get('q') || undefined
  const pageToken = p.get('pageToken') || undefined

  try {
    const list = await listMessages(accountId, { labelIds, q, pageToken, maxResults: 25 })
    const ids = list.messages ?? []
    const summaries = await Promise.all(ids.map(async ({ id, threadId }) => {
      const m = await getMessage(accountId, id, 'metadata') as {
        labelIds?: string[]; snippet?: string; internalDate?: string
        payload?: { headers?: Header[] }
      }
      const h = m.payload?.headers
      return {
        id, threadId,
        from: header(h, 'From'),
        subject: header(h, 'Subject'),
        snippet: m.snippet ?? '',
        date: m.internalDate ? Number(m.internalDate) : null,
        unread: (m.labelIds ?? []).includes('UNREAD'),
        labelIds: m.labelIds ?? [],
      }
    }))
    return NextResponse.json({ messages: summaries, nextPageToken: list.nextPageToken ?? null })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load messages' }, { status: 502 })
  }
}
