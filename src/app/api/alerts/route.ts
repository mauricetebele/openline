/**
 * GET /api/alerts — Paginated list of alerts, newest first
 * ?archived=true  → show archived alerts
 * ?archived=false → show unarchived alerts (default)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '25')))
  const skip = (page - 1) * limit

  const showArchived = searchParams.get('archived') === 'true'
  const where = showArchived
    ? { archivedAt: { not: null } }
    : { archivedAt: null }

  const [alerts, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.alert.count({ where }),
  ])

  return NextResponse.json({
    data: alerts,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
}
