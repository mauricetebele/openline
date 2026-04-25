import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

// GET /api/cases/[id] — case detail
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const c = await prisma.case.findUnique({
    where: { id: params.id },
    include: {
      createdBy: { select: { id: true, name: true } },
      resolvedBy: { select: { id: true, name: true } },
      taggedUsers: { include: { user: { select: { id: true, name: true, email: true } } } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true } } },
      },
    },
  })

  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(c)
}

// PATCH /api/cases/[id] — update case (title/description)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.case.findUnique({
    where: { id: params.id },
    select: { createdById: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.createdById !== user.dbId) {
    return NextResponse.json({ error: 'Only the creator can edit this case' }, { status: 403 })
  }

  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (body.title !== undefined) data.title = body.title?.trim() || undefined
  if (body.description !== undefined) data.description = body.description?.trim() || null

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.case.update({
    where: { id: params.id },
    data,
    include: {
      createdBy: { select: { id: true, name: true } },
      resolvedBy: { select: { id: true, name: true } },
      taggedUsers: { include: { user: { select: { id: true, name: true, email: true } } } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true } } },
      },
    },
  })

  return NextResponse.json(updated)
}
