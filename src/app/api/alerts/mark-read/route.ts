/**
 * POST /api/alerts/mark-read — Mark alerts as read
 * Body: { ids: string[] } or { all: true }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { ids?: string[]; all?: boolean }

  if (body.all) {
    await prisma.alert.updateMany({
      where: { readAt: null },
      data: { readAt: new Date() },
    })
  } else if (body.ids && body.ids.length > 0) {
    await prisma.alert.updateMany({
      where: { id: { in: body.ids }, readAt: null },
      data: { readAt: new Date() },
    })
  } else {
    return NextResponse.json({ error: 'Provide ids array or all: true' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
