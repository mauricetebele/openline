/**
 * POST /api/alerts/archive — Archive or unarchive alerts
 * Body: { ids: string[] }               → archive specific alerts
 *        { all: true }                   → archive all unarchived alerts
 *        { ids: string[], unarchive: true } → unarchive specific alerts
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { ids, all, unarchive } = body as {
    ids?: string[]
    all?: boolean
    unarchive?: boolean
  }

  if (unarchive && ids?.length) {
    // Unarchive specific alerts
    const { count } = await prisma.alert.updateMany({
      where: { id: { in: ids } },
      data: { archivedAt: null },
    })
    return NextResponse.json({ updated: count })
  }

  if (all) {
    // Archive all unarchived alerts (only read ones)
    const { count } = await prisma.alert.updateMany({
      where: { archivedAt: null, readAt: { not: null } },
      data: { archivedAt: new Date() },
    })
    return NextResponse.json({ updated: count })
  }

  if (ids?.length) {
    // Archive specific alerts
    const { count } = await prisma.alert.updateMany({
      where: { id: { in: ids } },
      data: { archivedAt: new Date() },
    })
    return NextResponse.json({ updated: count })
  }

  return NextResponse.json({ error: 'Provide ids or all:true' }, { status: 400 })
}
