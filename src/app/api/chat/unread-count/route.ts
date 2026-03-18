import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

// GET — total unread message count across all conversations
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const count = await prisma.chatMessage.count({
    where: {
      conversation: {
        OR: [{ user1Id: user.dbId }, { user2Id: user.dbId }],
      },
      senderId: { not: user.dbId },
      readAt: null,
    },
  })

  return NextResponse.json({ count })
}
