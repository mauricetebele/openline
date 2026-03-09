import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { body: commentBody } = body

  if (!commentBody?.trim()) {
    return NextResponse.json({ error: 'Comment body is required' }, { status: 400 })
  }

  // Verify todo exists and belongs to user
  const todo = await prisma.todo.findUnique({ where: { id: params.id }, select: { userId: true } })
  if (!todo) return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
  if (todo.userId !== user.dbId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const comment = await prisma.todoComment.create({
    data: {
      todoId: params.id,
      authorId: user.dbId,
      body: commentBody.trim(),
    },
    include: {
      author: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json(comment, { status: 201 })
}
