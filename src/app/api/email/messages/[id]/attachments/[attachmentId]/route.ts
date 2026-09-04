/**
 * GET /api/email/messages/[id]/attachments/[attachmentId]?accountId=
 * Returns the attachment bytes as standard base64 for preview/download.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { getAttachment } from '@/lib/email/google'
import { canUseMailAccount } from '@/lib/email/access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string; attachmentId: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const accountId = req.nextUrl.searchParams.get('accountId')
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  if (!(await canUseMailAccount(accountId, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const att = await getAttachment(accountId, params.id, params.attachmentId)
    if (!att.data) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    // Gmail returns base64url — convert to standard base64 the browser's atob() expects.
    const std = att.data.replace(/-/g, '+').replace(/_/g, '/')
    return NextResponse.json({ data: std })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load attachment' }, { status: 502 })
  }
}
