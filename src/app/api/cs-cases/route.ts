/**
 * GET  /api/cs-cases?tab=open|resolved — Marketplace CS cases for the viewer
 *      (admin: all; agent: own), with per-viewer unread flags + tab counts.
 * POST /api/cs-cases — open a new case: { orderId?, description, attachments? }
 *      The description becomes the first message of the thread.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const CAN_ACCESS = (role: string) => role === 'ADMIN' || role === 'MARKETPLACE_CS'

interface Attachment { url: string; filename: string; contentType: string; size: number }

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_ACCESS(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isAdmin = user.role === 'ADMIN'
  const tab = req.nextUrl.searchParams.get('tab') === 'resolved' ? 'RESOLVED' : 'OPEN'
  const scope = isAdmin ? {} : { createdById: user.dbId }

  const rows = await prisma.csCase.findMany({
    where: { status: tab as 'OPEN' | 'RESOLVED', ...scope },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      resolvedBy: { select: { name: true } },
      _count: { select: { messages: true } },
    },
    take: 1000,
  })

  // Tab counts + unread count for the badge (within the viewer's scope).
  const grouped = await prisma.csCase.groupBy({ by: ['status'], where: scope, _count: { _all: true } })
  const counts = { open: 0, resolved: 0 }
  for (const g of grouped) { if (g.status === 'OPEN') counts.open = g._count._all; else counts.resolved = g._count._all }

  const cases = rows.map(c => {
    const readAt = isAdmin ? c.adminReadAt : c.agentReadAt
    const unread = c.lastMessageById !== user.dbId && (!readAt || c.lastMessageAt > readAt)
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      orderId: c.orderId,
      status: c.status,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
      lastMessageAt: c.lastMessageAt,
      resolvedAt: c.resolvedAt,
      resolvedByName: c.resolvedBy?.name ?? null,
      messageCount: c._count.messages,
      unread,
    }
  })

  return NextResponse.json({ cases, counts })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_ACCESS(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const b = await req.json().catch(() => ({})) as { orderId?: string; description?: string; attachments?: Attachment[] }
  const description = typeof b.description === 'string' ? b.description.trim() : ''
  const attachments = Array.isArray(b.attachments) ? b.attachments : []
  if (!description && attachments.length === 0) {
    return NextResponse.json({ error: 'A description (or at least one attachment) is required' }, { status: 400 })
  }

  const isAdmin = user.role === 'ADMIN'
  const now = new Date()
  const created = await prisma.csCase.create({
    data: {
      orderId: b.orderId?.trim() || null,
      createdById: user.dbId,
      lastMessageAt: now,
      lastMessageById: user.dbId,
      // The opener has "read" their own first message.
      agentReadAt: isAdmin ? null : now,
      adminReadAt: isAdmin ? now : null,
      messages: {
        create: {
          authorId: user.dbId,
          body: description || '(see attachments)',
          attachments: attachments.length ? (attachments as unknown as Prisma.InputJsonValue) : undefined,
        },
      },
    },
    select: { id: true, caseNumber: true },
  })

  return NextResponse.json({ ok: true, id: created.id, caseNumber: created.caseNumber })
}
