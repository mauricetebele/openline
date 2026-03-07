import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/grades — distinct grade strings used across all serials */
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await prisma.productGrade.findMany({
    select: { grade: true },
    distinct: ['grade'],
    orderBy: { grade: 'asc' },
  })

  return NextResponse.json({ data: rows.map(r => r.grade) })
}
