import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { put } from '@vercel/blob'

// GET — paginated messages (supports ?after=timestamp for polling)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Verify user is part of this conversation
  const conversation = await prisma.chatConversation.findFirst({
    where: {
      id,
      OR: [{ user1Id: user.dbId }, { user2Id: user.dbId }],
    },
  })
  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const after = req.nextUrl.searchParams.get('after')
  const take = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)

  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId: id,
      ...(after ? { createdAt: { gt: new Date(after) } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take,
    include: {
      sender: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json(messages)
}

// POST — send message (FormData with optional file + optional body)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Verify user is part of this conversation
  const conversation = await prisma.chatConversation.findFirst({
    where: {
      id,
      OR: [{ user1Id: user.dbId }, { user2Id: user.dbId }],
    },
  })
  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formData: any = await req.formData()
  const body = (formData.get('body') as string | null)?.trim() || null
  const file = formData.get('file') as File | null

  if (!body && !file) {
    return NextResponse.json(
      { error: 'Message body or file required' },
      { status: 400 }
    )
  }

  let fileName: string | null = null
  let fileUrl: string | null = null
  let fileSize: number | null = null
  let fileMimeType: string | null = null

  if (file) {
    const blob = await put(`chat/${id}/${file.name}`, file, { access: 'public' })
    fileName = file.name
    fileUrl = blob.url
    fileSize = file.size
    fileMimeType = file.type || null
  }

  const now = new Date()
  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        conversationId: id,
        senderId: user.dbId,
        body,
        fileName,
        fileUrl,
        fileSize,
        fileMimeType,
      },
      include: {
        sender: { select: { id: true, name: true } },
      },
    }),
    prisma.chatConversation.update({
      where: { id },
      data: { lastMessageAt: now },
    }),
  ])

  return NextResponse.json(message)
}
