/**
 * GET /api/refunds
 *
 * Query params:
 *   page         number (default 1)
 *   pageSize     number (default 25, max 100)
 *   startDate    ISO date string (filter by postedDate >=)
 *   endDate      ISO date string (filter by postedDate <=)
 *   fulfillment  FBA | MFN | UNKNOWN
 *   status       UNREVIEWED | VALID | INVALID
 *   accountId    string
 *   search       string (orderId, sku, asin, adjustmentId — partial match)
 *   sortBy       postedDate | amount | status (default postedDate)
 *   sortDir      asc | desc (default desc)
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? '25')))
  const skip = (page - 1) * pageSize

  // Build WHERE clause
  const where: Prisma.RefundWhereInput = {}

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  if (startDate || endDate) {
    where.postedDate = {}
    if (startDate) where.postedDate.gte = new Date(startDate)
    if (endDate) where.postedDate.lte = new Date(endDate)
  }

  const fulfillment = searchParams.get('fulfillment')
  if (fulfillment && ['FBA', 'MFN', 'UNKNOWN'].includes(fulfillment)) {
    where.fulfillmentType = fulfillment as 'FBA' | 'MFN' | 'UNKNOWN'
  }

  const accountId = searchParams.get('accountId')
  if (accountId) where.accountId = accountId

  const search = searchParams.get('search')?.trim()
  if (search) {
    where.OR = [
      { orderId: { contains: search, mode: 'insensitive' } },
      { adjustmentId: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { asin: { contains: search, mode: 'insensitive' } },
      { productTitle: { contains: search, mode: 'insensitive' } },
    ]
  }

  const statusFilter = searchParams.get('status')
  if (statusFilter && ['UNREVIEWED', 'VALID', 'INVALID'].includes(statusFilter)) {
    where.review = { status: statusFilter as 'UNREVIEWED' | 'VALID' | 'INVALID' }
  }

  // Build ORDER BY
  const sortBy = searchParams.get('sortBy') ?? 'postedDate'
  const sortDir = (searchParams.get('sortDir') ?? 'desc') as 'asc' | 'desc'

  let orderBy: Prisma.RefundOrderByWithRelationInput
  if (sortBy === 'amount') {
    orderBy = { amount: sortDir }
  } else if (sortBy === 'status') {
    orderBy = { review: { status: sortDir } }
  } else {
    orderBy = { postedDate: sortDir }
  }

  const [total, refunds] = await Promise.all([
    prisma.refund.count({ where }),
    prisma.refund.findMany({
      where,
      skip,
      take: pageSize,
      orderBy,
      include: {
        review: {
          include: { reviewedBy: { select: { name: true, email: true } } },
        },
        account: { select: { marketplaceName: true, sellerId: true } },
      },
    }),
  ])

  return NextResponse.json({
    data: refunds,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}
