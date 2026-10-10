/**
 * GET /api/cs-cases/unread-count — number of OPEN cases with unread activity for
 * the viewer (admin: all; agent: own). Powers the nav badge.
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && user.role !== 'MARKETPLACE_CS') {
    return NextResponse.json({ count: 0 })
  }

  const isAdmin = user.role === 'ADMIN'
  const rows = await prisma.csCase.findMany({
    // Only OPEN cases count — new activity on a resolved case shouldn't bump the badge.
    where: { status: 'OPEN', ...(isAdmin ? {} : { createdById: user.dbId }) },
    select: { lastMessageAt: true, lastMessageById: true, adminReadAt: true, agentReadAt: true },
    take: 2000,
  })

  let count = 0
  for (const c of rows) {
    const readAt = isAdmin ? c.adminReadAt : c.agentReadAt
    if (c.lastMessageById !== user.dbId && (!readAt || c.lastMessageAt > readAt)) count++
  }
  return NextResponse.json({ count })
}
