import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

// GET — list user's conversations with last message + unread count
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const conversations = await prisma.chatConversation.findMany({
    where: {
      OR: [{ user1Id: user.dbId }, { user2Id: user.dbId }],
    },
    include: {
      user1: { select: { id: true, name: true, email: true, lastSeenAt: true } },
      user2: { select: { id: true, name: true, email: true, lastSeenAt: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, createdAt: true, senderId: true, fileName: true },
      },
    },
    orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
  })

  // Get unread counts in one query
  const unreadCounts = await prisma.chatMessage.groupBy({
    by: ['conversationId'],
    where: {
      conversationId: { in: conversations.map((c) => c.id) },
      senderId: { not: user.dbId },
      readAt: null,
    },
    _count: true,
  })
  const unreadMap = new Map(unreadCounts.map((u) => [u.conversationId, u._count]))

  const result = conversations.map((c) => {
    const otherUser = c.user1Id === user.dbId ? c.user2 : c.user1
    const lastMessage = c.messages[0] ?? null
    return {
      id: c.id,
      otherUser,
      lastMessage,
      unreadCount: unreadMap.get(c.id) ?? 0,
    }
  })

  return NextResponse.json(result)
}

// POST — find or create conversation { userId }
export async function POST(req: Request) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = await req.json()
  if (!userId || userId === user.dbId) {
    return NextResponse.json({ error: 'Invalid user' }, { status: 400 })
  }

  // Ensure consistent ordering: user1Id < user2Id
  const [user1Id, user2Id] =
    user.dbId < userId ? [user.dbId, userId] : [userId, user.dbId]

  const conversation = await prisma.chatConversation.upsert({
    where: { user1Id_user2Id: { user1Id, user2Id } },
    create: { user1Id, user2Id },
    update: {},
    include: {
      user1: { select: { id: true, name: true, email: true, lastSeenAt: true } },
      user2: { select: { id: true, name: true, email: true, lastSeenAt: true } },
    },
  })

  const otherUser =
    conversation.user1Id === user.dbId ? conversation.user2 : conversation.user1

  return NextResponse.json({
    id: conversation.id,
    otherUser,
    lastMessage: null,
    unreadCount: 0,
  })
}
