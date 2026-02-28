import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search')?.trim()
  const status = searchParams.get('status')

  const where: Record<string, unknown> = {}

  if (status === 'UNRESOLVED' || status === 'RESOLVED') {
    where.status = status
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
      { createdBy: { name: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const cases = await prisma.case.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  })

  return NextResponse.json({ data: cases })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, description, assignedToId, marketplaceCaseIds } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const newCase = await prisma.case.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      assignedToId: assignedToId || null,
      createdById: user.dbId,
      marketplaceCaseIds: Array.isArray(marketplaceCaseIds)
        ? marketplaceCaseIds.map((s: string) => s.trim()).filter(Boolean)
        : [],
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  })

  return NextResponse.json(newCase, { status: 201 })
}
