/**
 * GET /api/sickw/checks — paginated SICKW check history
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const search = sp.get('search')?.trim() ?? ''
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '25', 10)))
  const skip = (page - 1) * limit

  const where = search ? { imei: { contains: search } } : {}

  const [checks, total] = await Promise.all([
    prisma.sickwCheck.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.sickwCheck.count({ where }),
  ])

  return NextResponse.json({
    checks: checks.map(c => ({
      ...c,
      cost: c.cost ? Number(c.cost) : null,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  })
}
