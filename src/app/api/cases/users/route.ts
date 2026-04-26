import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

// GET /api/cases/users — lightweight user list for case tagging
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let users

  if (user.role === 'RESOLUTION_PROVIDER') {
    // Only return users this provider is allowed to see
    const visibility = await prisma.resolutionProviderVisibility.findMany({
      where: { resolutionProviderId: user.dbId },
      select: { visibleUserId: true },
    })
    const visibleIds = visibility.map(v => v.visibleUserId)
    users = await prisma.user.findMany({
      where: { id: { in: visibleIds } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    })
  } else {
    users = await prisma.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    })
  }

  return NextResponse.json({ data: users })
}
