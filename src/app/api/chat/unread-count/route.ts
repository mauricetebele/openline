import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

// GET — total unread message count across all conversations
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const where = {
    conversation: {
      OR: [{ user1Id: user.dbId }, { user2Id: user.dbId }],
    },
    senderId: { not: user.dbId },
    readAt: null,
  }

  const [count, latest] = await Promise.all([
    prisma.chatMessage.count({ where }),
    prisma.chatMessage.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        body: true,
        fileName: true,
        createdAt: true,
        sender: { select: { name: true } },
      },
    }),
  ])

  return NextResponse.json({ count, latest })
}
