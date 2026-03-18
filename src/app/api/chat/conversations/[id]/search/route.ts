import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

// GET /api/chat/conversations/[id]/search?q=term — search messages in a conversation
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  if (!q) return NextResponse.json([])

  // Verify user is part of this conversation
  const conv = await prisma.chatConversation.findFirst({
    where: {
      id: params.id,
      OR: [{ user1Id: user.dbId }, { user2Id: user.dbId }],
    },
  })
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId: params.id,
      body: { contains: q, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      body: true,
      createdAt: true,
      senderId: true,
      sender: { select: { id: true, name: true } },
      fileName: true,
      fileUrl: true,
      fileSize: true,
      fileMimeType: true,
    },
    take: 50,
  })

  return NextResponse.json(messages)
}
