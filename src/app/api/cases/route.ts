import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

// GET /api/cases — list cases
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const search = url.searchParams.get('search')?.trim() || ''
  const status = url.searchParams.get('status') || 'all'

  const where: Record<string, unknown> = {}

  if (status === 'UNRESOLVED' || status === 'RESOLVED') {
    where.status = status
  }

  if (search) {
    const num = parseInt(search, 10)
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      ...(Number.isFinite(num) ? [{ caseNumber: num }] : []),
    ]
  }

  const cases = await prisma.case.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      taggedUsers: { include: { user: { select: { id: true, name: true } } } },
      _count: { select: { messages: true } },
    },
  })

  return NextResponse.json({ data: cases })
}

// POST /api/cases — create case
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, description, taggedUserIds } = body as {
    title?: string
    description?: string
    taggedUserIds?: string[]
  }

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const created = await prisma.case.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      createdById: user.dbId,
      taggedUsers: {
        create: (taggedUserIds ?? []).map(uid => ({ userId: uid })),
      },
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      taggedUsers: { include: { user: { select: { id: true, name: true } } } },
      _count: { select: { messages: true } },
    },
  })

  return NextResponse.json(created, { status: 201 })
}
