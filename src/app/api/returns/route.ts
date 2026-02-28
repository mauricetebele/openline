import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const accountId       = searchParams.get('accountId')
  const search          = searchParams.get('search')?.trim()
  const page            = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit           = Math.min(1000, parseInt(searchParams.get('limit') ?? '50', 10))
  const trackingFilter  = searchParams.get('trackingFilter') ?? 'all'
  const returnDateFrom  = searchParams.get('returnDateFrom')
  const returnDateTo    = searchParams.get('returnDateTo')
  const sortDir         = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

  // Build AND array so search OR and tracking OR never clobber each other
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const andClauses: Record<string, any>[] = []

  if (accountId) andClauses.push({ accountId })

  if (search) {
    andClauses.push({
      OR: [
        { orderId:        { contains: search, mode: 'insensitive' } },
        { trackingNumber: { contains: search, mode: 'insensitive' } },
        { rmaId:          { contains: search, mode: 'insensitive' } },
        { title:          { contains: search, mode: 'insensitive' } },
        { sku:            { contains: search, mode: 'insensitive' } },
      ],
    })
  }

  // Tracking status filter
  if (trackingFilter === 'delivered') {
    andClauses.push({ deliveredAt: { not: null } })
  } else if (trackingFilter === 'in_transit') {
    andClauses.push({ estimatedDelivery: { not: null } })
    andClauses.push({ deliveredAt: null })
  } else if (trackingFilter === 'not_checked') {
    andClauses.push({ trackingNumber: { not: null } })
    andClauses.push({
      OR: [
        { carrierStatus: null },
        { carrierStatus: 'Unable to fetch status' },
      ],
    })
  } else if (trackingFilter === 'no_tracking') {
    andClauses.push({ trackingNumber: null })
  }

  // Return date range filter
  if (returnDateFrom || returnDateTo) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dateClause: Record<string, any> = {}
    if (returnDateFrom) dateClause.gte = new Date(returnDateFrom)
    if (returnDateTo) {
      const to = new Date(returnDateTo)
      to.setHours(23, 59, 59, 999)
      dateClause.lte = to
    }
    andClauses.push({ returnDate: dateClause })
  }

  const where = andClauses.length > 0 ? { AND: andClauses } : {}

  const [returns, total] = await Promise.all([
    prisma.mFNReturn.findMany({
      where,
      orderBy: { returnDate: sortDir },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.mFNReturn.count({ where }),
  ])

  return NextResponse.json({ data: returns, total, page, limit })
}
