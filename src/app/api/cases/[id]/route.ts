import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

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
      assignedTo: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true } } },
      },
      _count: { select: { messages: true } },
    },
  })

  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(c)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, description, status, assignedToId, marketplaceCaseIds } = body

  const data: Record<string, unknown> = {}
  if (title !== undefined)       data.title       = title?.trim() || undefined
  if (description !== undefined) data.description = description?.trim() || null
  if (status !== undefined)      data.status      = status
  if (assignedToId !== undefined) data.assignedToId = assignedToId || null
  if (marketplaceCaseIds !== undefined) {
    data.marketplaceCaseIds = Array.isArray(marketplaceCaseIds)
      ? marketplaceCaseIds.map((s: string) => s.trim()).filter(Boolean)
      : []
  }

  const updated = await prisma.case.update({
    where: { id: params.id },
    data,
    include: {
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true } } },
      },
      _count: { select: { messages: true } },
    },
  })

  return NextResponse.json(updated)
}
