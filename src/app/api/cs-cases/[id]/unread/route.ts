/**
 * POST /api/cs-cases/[id]/unread — mark a case unread for the current viewer by
 * clearing their read timestamp (admin → adminReadAt, agent → agentReadAt). The
 * case then shows unread as long as its last message was from the other party.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && user.role !== 'MARKETPLACE_CS') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params

  const c = await prisma.csCase.findUnique({ where: { id }, select: { id: true, createdById: true } })
  if (!c) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (user.role !== 'ADMIN' && c.createdById !== user.dbId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.csCase.update({
    where: { id },
    data: user.role === 'ADMIN' ? { adminReadAt: null } : { agentReadAt: null },
  })
  return NextResponse.json({ ok: true })
}
