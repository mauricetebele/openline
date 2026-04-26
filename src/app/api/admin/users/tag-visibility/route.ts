import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

// GET ?userId= — returns visible user IDs for a Resolution Provider
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || user.role !== 'ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId)
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  const rows = await prisma.resolutionProviderVisibility.findMany({
    where: { resolutionProviderId: userId },
    select: { visibleUserId: true },
  })

  return NextResponse.json({
    data: rows.map(r => r.visibleUserId),
  })
}

// PUT { userId, visibleUserIds[] } — replaces all visibility atomically
export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || user.role !== 'ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { userId, visibleUserIds } = body as { userId?: string; visibleUserIds?: string[] }

  if (!userId)
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  if (!Array.isArray(visibleUserIds))
    return NextResponse.json({ error: 'visibleUserIds must be an array' }, { status: 400 })

  await prisma.$transaction([
    prisma.resolutionProviderVisibility.deleteMany({ where: { resolutionProviderId: userId } }),
    ...(visibleUserIds.length > 0
      ? [prisma.resolutionProviderVisibility.createMany({
          data: visibleUserIds.map(visibleUserId => ({ resolutionProviderId: userId, visibleUserId })),
          skipDuplicates: true,
        })]
      : []),
  ])

  return NextResponse.json({ ok: true, count: visibleUserIds.length })
}
