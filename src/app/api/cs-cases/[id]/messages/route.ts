/**
 * POST /api/cs-cases/[id]/messages — add a message to the thread.
 * Body: { body, attachments? }. Updates thread activity + marks read for the author.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { sendCsCaseMessageNotification } from '@/lib/cs-case-emails'

export const dynamic = 'force-dynamic'

interface Attachment { url: string; filename: string; contentType: string; size: number }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && user.role !== 'MARKETPLACE_CS') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params

  const b = await req.json().catch(() => ({})) as { body?: string; attachments?: Attachment[] }
  const body = typeof b.body === 'string' ? b.body.trim() : ''
  const attachments = Array.isArray(b.attachments) ? b.attachments : []
  if (!body && attachments.length === 0) {
    return NextResponse.json({ error: 'Message body or attachment required' }, { status: 400 })
  }

  const c = await prisma.csCase.findUnique({
    where: { id },
    select: { id: true, caseNumber: true, createdById: true, createdBy: { select: { email: true, name: true } } },
  })
  if (!c) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  const isAdmin = user.role === 'ADMIN'
  if (!isAdmin && c.createdById !== user.dbId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now = new Date()
  const [msg] = await prisma.$transaction([
    prisma.csCaseMessage.create({
      data: { caseId: id, authorId: user.dbId, body: body || '(see attachments)', attachments: attachments.length ? (attachments as unknown as Prisma.InputJsonValue) : undefined },
    }),
    prisma.csCase.update({
      where: { id },
      data: {
        lastMessageAt: now,
        lastMessageById: user.dbId,
        // author has read up to their own message
        ...(isAdmin ? { adminReadAt: now } : { agentReadAt: now }),
      },
    }),
  ])

  // Notify the case's customer-service agent (the creator) at their login email
  // whenever someone else posts — i.e. when we (admin) reply on their thread.
  if (c.createdById !== user.dbId && c.createdBy?.email) {
    sendCsCaseMessageNotification({
      caseId: id,
      caseNumber: c.caseNumber,
      authorName: user.name || user.email,
      body: body || '(see attachments)',
      hasAttachments: attachments.length > 0,
      recipientEmail: c.createdBy.email,
      recipientName: c.createdBy.name || c.createdBy.email.split('@')[0],
    })
  }

  return NextResponse.json({ ok: true, id: msg.id })
}
