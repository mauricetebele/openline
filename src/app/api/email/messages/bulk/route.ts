/**
 * POST /api/email/messages/bulk
 * Body: { accountId, ids: string[], addLabelIds?, removeLabelIds?, trash?: boolean }
 * Applies a label change (or trashes) many messages at once via Gmail batchModify.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { batchModify } from '@/lib/email/google'
import { canUseMailAccount } from '@/lib/email/access'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { accountId, ids, addLabelIds, removeLabelIds, trash } = body as {
    accountId?: string; ids?: string[]; addLabelIds?: string[]; removeLabelIds?: string[]; trash?: boolean
  }
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  if (!(await canUseMailAccount(accountId, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const list = Array.isArray(ids) ? ids.filter(Boolean) : []
  if (list.length === 0) return NextResponse.json({ error: 'No messages selected' }, { status: 400 })

  // Trashing = add the TRASH system label (also drop it out of the Inbox).
  const add = trash ? ['TRASH', ...(addLabelIds ?? [])] : addLabelIds
  const remove = trash ? ['INBOX', ...(removeLabelIds ?? [])] : removeLabelIds

  try {
    // batchModify handles up to 1000 ids per call.
    for (let i = 0; i < list.length; i += 1000) {
      await batchModify(accountId, list.slice(i, i + 1000), add?.length ? add : undefined, remove?.length ? remove : undefined)
    }
    return NextResponse.json({ ok: true, count: list.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Bulk action failed' }, { status: 502 })
  }
}
