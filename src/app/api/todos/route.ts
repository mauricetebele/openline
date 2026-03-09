import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const todos = await prisma.todo.findMany({
    where: { userId: user.dbId },
    orderBy: [
      { dueDate: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'desc' },
    ],
    include: {
      _count: { select: { comments: true } },
    },
  })

  return NextResponse.json({ data: todos })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, description, priority, dueDate } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const todo = await prisma.todo.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      priority: priority || 'NORMAL',
      dueDate: dueDate ? new Date(dueDate) : null,
      userId: user.dbId,
    },
    include: {
      _count: { select: { comments: true } },
    },
  })

  return NextResponse.json(todo, { status: 201 })
}
