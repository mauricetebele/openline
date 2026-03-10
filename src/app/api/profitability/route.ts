/**
 * GET /api/profitability
 *
 * Returns profitability breakdown for shipped orders in date range.
 * Combines marketplace orders (Amazon/BackMarket) and wholesale (SalesOrder).
 *
 * Query params: startDate, endDate, page (default 1), pageSize (default 50)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { Prisma } from '@prisma/client'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') ?? '50', 10)))

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  const dateFrom = new Date(startDate + 'T00:00:00Z')
  const dateTo = new Date(endDate + 'T23:59:59.999Z')

  // ── COGS lookup: latest unit cost per product+grade ─────────────────────
  const cogsRows = await prisma.$queryRaw<
    { productId: string; gradeId: string | null; unitCost: number }[]
  >(Prisma.sql`
    SELECT DISTINCT ON ("productId", "gradeId")
      "productId", "gradeId", "unitCost"::float8 as "unitCost"
    FROM purchase_order_lines
    ORDER BY "productId", "gradeId", "createdAt" DESC
  `)
  const cogsMap = new Map<string, number>()
  for (const row of cogsRows) {
    cogsMap.set(`${row.productId}:${row.gradeId ?? ''}`, row.unitCost)
  }

  // ── Marketplace orders (SHIPPED) ────────────────────────────────────────
  const marketplaceWhere = {
    workflowStatus: 'SHIPPED' as const,
    shippedAt: { gte: dateFrom, lte: dateTo },
  }

  const [marketplaceOrders, marketplaceCount] = await Promise.all([
    prisma.order.findMany({
      where: marketplaceWhere,
      include: {
        items: true,
        label: { select: { shipmentCost: true } },
        reservations: { select: { productId: true, gradeId: true, qtyReserved: true, orderItemId: true } },
      },
      orderBy: { shippedAt: 'desc' },
    }),
    prisma.order.count({ where: marketplaceWhere }),
  ])

  // ── Wholesale orders (SHIPPED) ─────────────────────────────────────────
  const wholesaleWhere = {
    fulfillmentStatus: 'SHIPPED' as const,
    shippedAt: { gte: dateFrom, lte: dateTo },
  }

  const [wholesaleOrders, wholesaleCount] = await Promise.all([
    prisma.salesOrder.findMany({
      where: wholesaleWhere,
      include: {
        items: true,
        inventoryReservations: { select: { productId: true, gradeId: true, qtyReserved: true, salesOrderItemId: true } },
      },
      orderBy: { shippedAt: 'desc' },
    }),
    prisma.salesOrder.count({ where: wholesaleWhere }),
  ])

  // ── Build unified rows ─────────────────────────────────────────────────
  type ProfitRow = {
    id: string
    olmNumber: number | null
    marketplaceOrderId: string
    source: string
    orderDate: string
    saleValue: number
    totalCogs: number
    commission: number
    shippingCost: number
    netProfit: number
    commissionSynced: boolean
  }

  const rows: ProfitRow[] = []

  // Marketplace rows
  for (const order of marketplaceOrders) {
    const saleValue = Number(order.orderTotal ?? 0)
    const shippingCost = Number(order.label?.shipmentCost ?? 0)
    const commission = Number(order.marketplaceCommission ?? 0)
    const commissionSynced = !!order.commissionSyncedAt

    let totalCogs = 0
    for (const res of order.reservations) {
      const key = `${res.productId}:${res.gradeId ?? ''}`
      const unitCost = cogsMap.get(key) ?? 0
      totalCogs += unitCost * res.qtyReserved
    }

    const netProfit = saleValue - totalCogs - commission - shippingCost

    rows.push({
      id: order.id,
      olmNumber: order.olmNumber,
      marketplaceOrderId: order.amazonOrderId,
      source: order.orderSource,
      orderDate: (order.shippedAt ?? order.purchaseDate).toISOString(),
      saleValue,
      totalCogs: Math.round(totalCogs * 100) / 100,
      commission: Math.round(commission * 100) / 100,
      shippingCost: Math.round(shippingCost * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      commissionSynced,
    })
  }

  // Wholesale rows
  for (const order of wholesaleOrders) {
    const saleValue = Number(order.total ?? 0)
    const shippingCost = Number(order.shippingCost ?? 0)
    const commission = 0 // no marketplace commission for wholesale

    let totalCogs = 0
    for (const res of order.inventoryReservations) {
      const key = `${res.productId}:${res.gradeId ?? ''}`
      const unitCost = cogsMap.get(key) ?? 0
      totalCogs += unitCost * res.qtyReserved
    }

    const netProfit = saleValue - totalCogs - commission - shippingCost

    rows.push({
      id: order.id,
      olmNumber: null,
      marketplaceOrderId: order.orderNumber,
      source: 'wholesale',
      orderDate: (order.shippedAt ?? order.orderDate).toISOString(),
      saleValue,
      totalCogs: Math.round(totalCogs * 100) / 100,
      commission: 0,
      shippingCost: Math.round(shippingCost * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      commissionSynced: true, // N/A for wholesale
    })
  }

  // Sort all rows by date desc
  rows.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())

  // Summary
  const totalRevenue = rows.reduce((s, r) => s + r.saleValue, 0)
  const totalCogs = rows.reduce((s, r) => s + r.totalCogs, 0)
  const totalCommission = rows.reduce((s, r) => s + r.commission, 0)
  const totalShipping = rows.reduce((s, r) => s + r.shippingCost, 0)
  const totalNetProfit = rows.reduce((s, r) => s + r.netProfit, 0)

  // Paginate
  const totalCount = rows.length
  const paged = rows.slice((page - 1) * pageSize, page * pageSize)

  return NextResponse.json({
    rows: paged,
    totalCount,
    page,
    pageSize,
    summary: {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCogs: Math.round(totalCogs * 100) / 100,
      totalCommission: Math.round(totalCommission * 100) / 100,
      totalShipping: Math.round(totalShipping * 100) / 100,
      totalNetProfit: Math.round(totalNetProfit * 100) / 100,
    },
  })
}
