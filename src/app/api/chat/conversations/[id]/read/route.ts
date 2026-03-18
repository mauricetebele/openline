import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

// POST — mark unread messages in this conversation as read
export async function POST(
  _req: Request,
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

  await prisma.chatMessage.updateMany({
    where: {
      conversationId: id,
      senderId: { not: user.dbId },
      readAt: null,
    },
    data: { readAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
