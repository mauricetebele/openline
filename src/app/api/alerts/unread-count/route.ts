/**
 * GET /api/alerts/unread-count — Returns { count } for the bell badge
 * Only counts unread + unarchived alerts.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const count = await prisma.alert.count({
    where: { readAt: null, archivedAt: null },
  })

  return NextResponse.json({ count })
}
