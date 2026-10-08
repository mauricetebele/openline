/**
 * POST /api/cs-cases/[id]/resolve — mark a case resolved (moves it to the Resolved
 * tab). Body: { reopen?: true } re-opens a resolved case.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && user.role !== 'MARKETPLACE_CS') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const b = await req.json().catch(() => ({})) as { reopen?: boolean }

  const c = await prisma.csCase.findUnique({ where: { id }, select: { id: true, createdById: true } })
  if (!c) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (user.role !== 'ADMIN' && c.createdById !== user.dbId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updated = await prisma.csCase.update({
    where: { id },
    data: b.reopen
      ? { status: 'OPEN', resolvedAt: null, resolvedById: null }
      : { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: user.dbId },
    select: { status: true },
  })
  return NextResponse.json({ ok: true, status: updated.status })
}
