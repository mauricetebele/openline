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

  const todo = await prisma.todo.findUnique({
    where: { id: params.id },
    include: {
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true } } },
      },
      _count: { select: { comments: true } },
    },
  })

  if (!todo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (todo.userId !== user.dbId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json(todo)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.todo.findUnique({ where: { id: params.id }, select: { userId: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.userId !== user.dbId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { title, description, priority, completed, dueDate } = body

  const data: Record<string, unknown> = {}
  if (title !== undefined) data.title = title?.trim() || undefined
  if (description !== undefined) data.description = description?.trim() || null
  if (priority !== undefined) data.priority = priority
  if (completed !== undefined) data.completed = completed
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null

  const updated = await prisma.todo.update({
    where: { id: params.id },
    data,
    include: {
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true } } },
      },
      _count: { select: { comments: true } },
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.todo.findUnique({ where: { id: params.id }, select: { userId: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.userId !== user.dbId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.todo.delete({ where: { id: params.id } })

  return NextResponse.json({ success: true })
}
