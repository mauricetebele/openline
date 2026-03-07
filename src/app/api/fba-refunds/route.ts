/**
 * GET /api/fba-refunds
 *
 * Paginated list of FBA refunds with search, date filters, sorting,
 * validation-status filtering, orderItemInfo, and tab counts.
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

  // ── Base filters (shared by data query and tab counts) ──────────────────
  const baseWhere: Prisma.FbaRefundWhereInput = {}

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  if (startDate || endDate) {
    baseWhere.refundDate = {}
    if (startDate) baseWhere.refundDate.gte = new Date(startDate)
    if (endDate) baseWhere.refundDate.lte = new Date(endDate)
  }

  const accountId = searchParams.get('accountId')
  if (accountId) baseWhere.accountId = accountId

  const search = searchParams.get('search')?.trim()
  if (search) {
    baseWhere.OR = [
      { orderId: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { fnsku: { contains: search, mode: 'insensitive' } },
      { asin: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
    ]
  }

  // ── Validation status filter ────────────────────────────────────────────
  const validationStatusParam = searchParams.get('validationStatus')
  const needsAttentionParam = searchParams.get('needsAttention')
  const where: Prisma.FbaRefundWhereInput = { ...baseWhere }

  if (needsAttentionParam === 'true') {
    // MANUAL_REVIEW rows + UNVALIDATED rows that are NOT "Within the 60 day window"
    where.validationStatus = { in: ['UNVALIDATED', 'MANUAL_REVIEW'] }
    where.NOT = {
      validationStatus: 'UNVALIDATED',
      validationReason: 'Within the 60 day window',
    }
  } else if (validationStatusParam) {
    const statuses = validationStatusParam.split(',').map(s => s.trim()) as Array<'UNVALIDATED' | 'VALIDATED' | 'MANUAL_REVIEW'>
    where.validationStatus = statuses.length === 1 ? statuses[0] : { in: statuses }
  }

  // ── Reimbursed filter ─────────────────────────────────────────────────
  const reimbursedParam = searchParams.get('reimbursed')
  if (reimbursedParam === 'yes' || reimbursedParam === 'no') {
    const reimbursedOrderIds = await prisma.fbaReimbursement.findMany({
      where: { orderId: { not: null } },
      select: { orderId: true },
      distinct: ['orderId'],
    })
    const reimbursedSet = new Set(reimbursedOrderIds.map(r => r.orderId).filter(Boolean) as string[])
    if (reimbursedParam === 'yes') {
      where.orderId = { in: Array.from(reimbursedSet) }
    } else {
      where.orderId = { notIn: Array.from(reimbursedSet) }
    }
  }

  const sortBy = searchParams.get('sortBy') ?? 'refundDate'
  const sortDir = (searchParams.get('sortDir') ?? 'desc') as 'asc' | 'desc'

  const sortMap: Record<string, Prisma.FbaRefundOrderByWithRelationInput> = {
    refundDate: { refundDate: sortDir },
    refundAmount: { refundAmount: sortDir },
    orderId: { orderId: sortDir },
    sku: { sku: sortDir },
    fnsku: { fnsku: sortDir },
    asin: { asin: sortDir },
    title: { title: sortDir },
    originalOrderDate: { originalOrderDate: sortDir },
    refundQty: { refundQty: sortDir },
    validatedAt: { validatedAt: sortDir },
  }
  const orderBy = sortMap[sortBy] ?? { refundDate: sortDir }

  // ── Data + counts in parallel ───────────────────────────────────────────
  const [total, refunds, unvalidatedCount, validatedCount, windowAgg] = await Promise.all([
    prisma.fbaRefund.count({ where }),
    prisma.fbaRefund.findMany({
      where,
      skip,
      take: pageSize,
      orderBy,
      include: {
        account: { select: { marketplaceName: true } },
      },
    }),
    prisma.fbaRefund.count({ where: { ...baseWhere, validationStatus: { in: ['UNVALIDATED', 'MANUAL_REVIEW'] } } }),
    prisma.fbaRefund.count({ where: { ...baseWhere, validationStatus: 'VALIDATED' } }),
    prisma.fbaRefund.groupBy({
      by: ['currency'],
      where: { ...baseWhere, validationReason: 'Within the 60 day window' },
      _sum: { refundAmount: true },
      _count: true,
    }),
  ])

  const orderIds = Array.from(new Set(refunds.map(r => r.orderId)))

  // ── Cross-reference FBA returns ──────────────────────────────────────────
  const returnRows = orderIds.length > 0
    ? await prisma.fbaReturn.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, sku: true, fnsku: true, title: true, status: true, returnDate: true, statusChangeDate: true, lpn: true },
      })
    : []

  const returnMap = new Map<string, { status: string; date: string | null; lpn: string | null }>()
  const returnFnskuMap = new Map<string, string>()
  const returnTitleMap = new Map<string, string>()
  const returnLpnMap = new Map<string, string>()

  for (const ret of returnRows) {
    if (ret.fnsku && ret.sku) {
      returnFnskuMap.set(`${ret.orderId}|${ret.sku}`, ret.fnsku)
    }
    if (ret.title && ret.sku) {
      returnTitleMap.set(`${ret.orderId}|${ret.sku}`, ret.title)
    }
    if (ret.lpn && !returnLpnMap.has(ret.orderId)) {
      returnLpnMap.set(ret.orderId, ret.lpn)
    }

    const isReturned = ret.status?.toLowerCase().includes('returned') ?? false
    const bestDate = ret.statusChangeDate ?? ret.returnDate
    const existing = returnMap.get(ret.orderId)
    if (!existing || (isReturned && !existing.status.toLowerCase().includes('returned'))) {
      returnMap.set(ret.orderId, {
        status: isReturned
          ? `Return Received on ${bestDate ? bestDate.toISOString().split('T')[0] : 'unknown date'}`
          : 'Not yet returned',
        date: bestDate?.toISOString() ?? null,
        lpn: ret.lpn ?? null,
      })
    }
  }

  // ── Cross-reference FBA reimbursements ───────────────────────────────────
  const reimbursementRows = orderIds.length > 0
    ? await prisma.fbaReimbursement.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, approvalDate: true, amountTotal: true, currencyUnit: true },
      })
    : []

  const reimbursementMap = new Map<string, { date: string; amount: string; currency: string }>()
  for (const r of reimbursementRows) {
    if (!r.orderId) continue
    const existing = reimbursementMap.get(r.orderId)
    const amt = r.amountTotal ? Number(r.amountTotal) : 0
    if (existing) {
      existing.amount = (Number(existing.amount) + amt).toFixed(2)
      if (r.approvalDate && r.approvalDate.toISOString() > existing.date) {
        existing.date = r.approvalDate.toISOString()
      }
    } else {
      reimbursementMap.set(r.orderId, {
        date: r.approvalDate?.toISOString() ?? '',
        amount: amt.toFixed(2),
        currency: r.currencyUnit ?? 'USD',
      })
    }
  }

  // ── Order → OrderItem info (line count + max qty) ───────────────────────
  const orderItemRows = orderIds.length > 0
    ? await prisma.order.findMany({
        where: { amazonOrderId: { in: orderIds } },
        select: {
          amazonOrderId: true,
          items: { select: { quantityOrdered: true } },
        },
      })
    : []

  const orderItemInfoMap = new Map<string, { lineItemCount: number; maxQty: number }>()
  for (const o of orderItemRows) {
    orderItemInfoMap.set(o.amazonOrderId, {
      lineItemCount: o.items.length,
      maxQty: o.items.reduce((max, i) => Math.max(max, i.quantityOrdered), 0),
    })
  }

  // ── FNSKU & Order Date fallback ──────────────────────────────────────────
  const missingFnskuSkus = new Set<string>()
  const missingOrderDateIds = new Set<string>()

  for (const r of refunds) {
    if (!r.fnsku && r.sku) missingFnskuSkus.add(r.sku)
    if (!r.originalOrderDate) missingOrderDateIds.add(r.orderId)
  }

  const listingFnskuMap = new Map<string, string>()
  if (missingFnskuSkus.size > 0) {
    const listings = await prisma.sellerListing.findMany({
      where: { sku: { in: Array.from(missingFnskuSkus) }, fnsku: { not: null } },
      select: { sku: true, fnsku: true },
    })
    for (const l of listings) {
      if (l.fnsku) listingFnskuMap.set(l.sku, l.fnsku)
    }
  }

  const orderDateMap = new Map<string, Date>()
  if (missingOrderDateIds.size > 0) {
    const orders = await prisma.order.findMany({
      where: { amazonOrderId: { in: Array.from(missingOrderDateIds) } },
      select: { amazonOrderId: true, purchaseDate: true },
    })
    for (const o of orders) {
      orderDateMap.set(o.amazonOrderId, o.purchaseDate)
    }
  }

  const data = refunds.map(r => {
    let fnsku = r.fnsku
    if (!fnsku && r.sku) {
      fnsku = returnFnskuMap.get(`${r.orderId}|${r.sku}`) ?? listingFnskuMap.get(r.sku) ?? null
    }

    let title = r.title
    if (!title && r.sku) {
      title = returnTitleMap.get(`${r.orderId}|${r.sku}`) ?? null
    }

    let originalOrderDate = r.originalOrderDate
    if (!originalOrderDate) {
      const fallback = orderDateMap.get(r.orderId)
      if (fallback) originalOrderDate = fallback
    }

    return {
      ...r,
      fnsku,
      title,
      originalOrderDate,
      returnInfo: returnMap.get(r.orderId) ?? null,
      lpn: returnLpnMap.get(r.orderId) ?? null,
      reimbursementInfo: reimbursementMap.get(r.orderId) ?? null,
      orderItemInfo: orderItemInfoMap.get(r.orderId) ?? null,
    }
  })

  return NextResponse.json({
    data,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    tabCounts: { unvalidated: unvalidatedCount, validated: validatedCount },
    withinWindow: windowAgg.map(g => ({
      currency: g.currency,
      total: Number(g._sum.refundAmount ?? 0),
      count: g._count,
    })),
  })
}
