import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const search = req.nextUrl.searchParams.get('search')?.trim() ?? ''

  const where = search
    ? {
        OR: [
          { replacementOrderId: { contains: search, mode: 'insensitive' as const } },
          { originalOrderId: { contains: search, mode: 'insensitive' as const } },
          { asin: { contains: search, mode: 'insensitive' as const } },
          { title: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {}

  const data = await prisma.freeReplacement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  return NextResponse.json({ data })
}
