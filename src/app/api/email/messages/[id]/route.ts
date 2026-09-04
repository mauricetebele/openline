/**
 * GET    /api/email/messages/[id]?accountId= — full message (parsed body); marks read
 * PATCH  /api/email/messages/[id]            — { accountId, addLabelIds?, removeLabelIds? }
 * DELETE /api/email/messages/[id]?accountId= — move to Trash
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { getMessage, modifyMessage, trashMessage } from '@/lib/email/google'
import { canUseMailAccount } from '@/lib/email/access'

export const dynamic = 'force-dynamic'

interface Header { name: string; value: string }
interface Part { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[]; headers?: Header[] }

function h(headers: Header[] | undefined, name: string): string {
  return headers?.find(x => x.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}
function decodeB64Url(data?: string): string {
  if (!data) return ''
  try { return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') } catch { return '' }
}
// Walk the MIME tree collecting the best body (prefer HTML) + attachment list.
function extract(part: Part | undefined, acc: { html: string; text: string; atts: { filename: string; mimeType: string; attachmentId: string; size: number }[] }) {
  if (!part) return
  const mime = part.mimeType ?? ''
  if (part.filename && part.body?.attachmentId) {
    acc.atts.push({ filename: part.filename, mimeType: mime, attachmentId: part.body.attachmentId, size: part.body.size ?? 0 })
  } else if (mime === 'text/html' && part.body?.data) {
    acc.html += decodeB64Url(part.body.data)
  } else if (mime === 'text/plain' && part.body?.data) {
    acc.text += decodeB64Url(part.body.data)
  }
  ;(part.parts ?? []).forEach(p => extract(p, acc))
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const accountId = req.nextUrl.searchParams.get('accountId')
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  if (!(await canUseMailAccount(accountId, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const m = await getMessage(accountId, params.id, 'full') as {
      id: string; threadId: string; labelIds?: string[]; internalDate?: string; snippet?: string; payload?: Part
    }
    const headers = m.payload?.headers
    const acc = { html: '', text: '', atts: [] as { filename: string; mimeType: string; attachmentId: string; size: number }[] }
    extract(m.payload, acc)

    // Mark as read on open.
    if ((m.labelIds ?? []).includes('UNREAD')) {
      await modifyMessage(accountId, params.id, { removeLabelIds: ['UNREAD'] }).catch(() => {})
    }

    return NextResponse.json({
      id: m.id, threadId: m.threadId,
      from: h(headers, 'From'), to: h(headers, 'To'), cc: h(headers, 'Cc'),
      subject: h(headers, 'Subject'), messageId: h(headers, 'Message-ID'),
      references: h(headers, 'References'),
      date: m.internalDate ? Number(m.internalDate) : null,
      labelIds: (m.labelIds ?? []).filter(l => l !== 'UNREAD'),
      html: acc.html, text: acc.text, attachments: acc.atts,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load message' }, { status: 502 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const accountId = body?.accountId
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  if (!(await canUseMailAccount(accountId, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    await modifyMessage(accountId, params.id, { addLabelIds: body.addLabelIds, removeLabelIds: body.removeLabelIds })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to update message' }, { status: 502 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const accountId = req.nextUrl.searchParams.get('accountId')
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  if (!(await canUseMailAccount(accountId, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    await trashMessage(accountId, params.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to trash message' }, { status: 502 })
  }
}
