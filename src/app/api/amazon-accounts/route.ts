import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.amazonAccount.findMany({
    select: { id: true, sellerId: true, marketplaceName: true, marketplaceId: true },
    orderBy: { marketplaceName: 'asc' },
  })

  return NextResponse.json({ data: accounts })
}
