/**
 * GET /api/profitability
 *
 * Returns profitability breakdown for shipped orders in date range.
 * Combines marketplace orders (Amazon/BackMarket) and wholesale (SalesOrder).
 *
 * Query params: startDate, endDate, page (default 1), pageSize (default 50),
 *               view ('order' | 'lineItem'), search (text filter)
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
  const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get('pageSize') ?? '50', 10)))
  const view = searchParams.get('view') ?? 'order'     // 'order' | 'lineItem'
  const search = searchParams.get('search')?.trim().toLowerCase() || ''

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

  // ── Cost code lookup: latest cost code amount per product+grade ────────
  const costCodeRows = await prisma.$queryRaw<
    { productId: string; gradeId: string | null; amount: number }[]
  >(Prisma.sql`
    SELECT DISTINCT ON (pol."productId", pol."gradeId")
      pol."productId", pol."gradeId", cc."amount"::float8 as "amount"
    FROM purchase_order_lines pol
    JOIN cost_codes cc ON cc.id = pol."costCodeId"
    WHERE pol."costCodeId" IS NOT NULL
    ORDER BY pol."productId", pol."gradeId", pol."createdAt" DESC
  `)
  const costCodeMap = new Map<string, number>()
  for (const row of costCodeRows) {
    costCodeMap.set(`${row.productId}:${row.gradeId ?? ''}`, row.amount)
  }

  // ── Marketplace orders (SHIPPED) ────────────────────────────────────────
  // Use shippedAt when available, fall back to purchaseDate
  const marketplaceWhere = {
    workflowStatus: 'SHIPPED' as const,
    OR: [
      { shippedAt: { gte: dateFrom, lte: dateTo } },
      { shippedAt: null, purchaseDate: { gte: dateFrom, lte: dateTo } },
    ],
  }

  const [marketplaceOrders, marketplaceCount] = await Promise.all([
    prisma.order.findMany({
      where: marketplaceWhere,
      include: {
        items: true,
        label: { select: { shipmentCost: true } },
        reservations: { select: { productId: true, gradeId: true, qtyReserved: true, orderItemId: true } },
      },
      orderBy: { purchaseDate: 'desc' },
    }),
    prisma.order.count({ where: marketplaceWhere }),
  ])

  // ── Wholesale orders (SHIPPED) ─────────────────────────────────────────
  const wholesaleWhere = {
    fulfillmentStatus: 'SHIPPED' as const,
    OR: [
      { shippedAt: { gte: dateFrom, lte: dateTo } },
      { shippedAt: null, orderDate: { gte: dateFrom, lte: dateTo } },
    ],
  }

  const [wholesaleOrders, wholesaleCount] = await Promise.all([
    prisma.salesOrder.findMany({
      where: wholesaleWhere,
      include: {
        items: true,
        inventoryReservations: { select: { productId: true, gradeId: true, qtyReserved: true, salesOrderItemId: true } },
      },
      orderBy: { orderDate: 'desc' },
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
    customerShipping: number
    shippingCost: number
    costCodeDeductions: number
    netProfit: number
    commissionSynced: boolean
  }

  const rows: ProfitRow[] = []

  // Marketplace rows
  for (const order of marketplaceOrders) {
    // Sale value excluding tax: sum item prices only (no tax)
    const saleValue = order.items.reduce((sum, item) => sum + Number(item.itemPrice ?? 0), 0)
    const customerShipping = order.items.reduce((sum, item) => sum + Number(item.shippingPrice ?? 0), 0)
    const shippingCost = Number(order.label?.shipmentCost ?? 0)
    const commission = Number(order.marketplaceCommission ?? 0)
    const commissionSynced = !!order.commissionSyncedAt

    let totalCogs = 0
    let costCodeDeductions = 0
    for (const res of order.reservations) {
      const key = `${res.productId}:${res.gradeId ?? ''}`
      const unitCost = cogsMap.get(key) ?? 0
      totalCogs += unitCost * res.qtyReserved
      const ccAmount = costCodeMap.get(key) ?? 0
      costCodeDeductions += ccAmount * res.qtyReserved
    }

    const netProfit = saleValue + customerShipping - totalCogs - commission - shippingCost - costCodeDeductions

    rows.push({
      id: order.id,
      olmNumber: order.olmNumber,
      marketplaceOrderId: order.amazonOrderId,
      source: order.orderSource,
      orderDate: (order.shippedAt ?? order.purchaseDate).toISOString(),
      saleValue: Math.round(saleValue * 100) / 100,
      totalCogs: Math.round(totalCogs * 100) / 100,
      commission: Math.round(commission * 100) / 100,
      customerShipping: Math.round(customerShipping * 100) / 100,
      shippingCost: Math.round(shippingCost * 100) / 100,
      costCodeDeductions: Math.round(costCodeDeductions * 100) / 100,
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
    let costCodeDeductions = 0
    for (const res of order.inventoryReservations) {
      const key = `${res.productId}:${res.gradeId ?? ''}`
      const unitCost = cogsMap.get(key) ?? 0
      totalCogs += unitCost * res.qtyReserved
      const ccAmount = costCodeMap.get(key) ?? 0
      costCodeDeductions += ccAmount * res.qtyReserved
    }

    const netProfit = saleValue - totalCogs - commission - shippingCost - costCodeDeductions

    rows.push({
      id: order.id,
      olmNumber: null,
      marketplaceOrderId: order.orderNumber,
      source: 'wholesale',
      orderDate: (order.shippedAt ?? order.orderDate).toISOString(),
      saleValue,
      totalCogs: Math.round(totalCogs * 100) / 100,
      commission: 0,
      customerShipping: 0,
      shippingCost: Math.round(shippingCost * 100) / 100,
      costCodeDeductions: Math.round(costCodeDeductions * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      commissionSynced: true, // N/A for wholesale
    })
  }

  // ── Line item flattening when view=lineItem ──────────────────────────
  type LineItemRow = ProfitRow & {
    orderId: string
    asin: string | null
    sellerSku: string | null
    title: string | null
    quantity: number
  }

  let finalRows: (ProfitRow | LineItemRow)[] = rows

  if (view === 'lineItem') {
    const lineItemRows: LineItemRow[] = []

    // Flatten marketplace orders
    for (const order of marketplaceOrders) {
      const totalCommissionVal = Number(order.marketplaceCommission ?? 0)
      const totalShippingVal = Number(order.label?.shipmentCost ?? 0)
      const commissionSyncedVal = !!order.commissionSyncedAt

      // Build reservation map keyed by orderItemId
      const resByItemId = new Map<string, { productId: string; gradeId: string | null; qtyReserved: number }[]>()
      for (const res of order.reservations) {
        const list = resByItemId.get(res.orderItemId) ?? []
        list.push(res)
        resByItemId.set(res.orderItemId, list)
      }

      const totalSale = order.items.reduce((sum, item) => sum + Number(item.itemPrice ?? 0), 0)

      for (const item of order.items) {
        const itemSale = Number(item.itemPrice ?? 0)
        const proportion = totalSale > 0 ? itemSale / totalSale : 0

        let itemCogs = 0
        let itemCostCodes = 0
        const reservations = resByItemId.get(item.id) ?? []
        for (const res of reservations) {
          const key = `${res.productId}:${res.gradeId ?? ''}`
          itemCogs += (cogsMap.get(key) ?? 0) * res.qtyReserved
          itemCostCodes += (costCodeMap.get(key) ?? 0) * res.qtyReserved
        }

        const itemCustomerShipping = Number(item.shippingPrice ?? 0)
        const itemCommission = totalCommissionVal * proportion
        const itemShipping = totalShippingVal * proportion
        const itemNetProfit = itemSale + itemCustomerShipping - itemCogs - itemCommission - itemShipping - itemCostCodes

        lineItemRows.push({
          id: `${order.id}:${item.id}`,
          orderId: order.id,
          olmNumber: order.olmNumber,
          marketplaceOrderId: order.amazonOrderId,
          source: order.orderSource,
          orderDate: (order.shippedAt ?? order.purchaseDate).toISOString(),
          asin: item.asin,
          sellerSku: item.sellerSku,
          title: item.title,
          quantity: item.quantityOrdered,
          saleValue: Math.round(itemSale * 100) / 100,
          totalCogs: Math.round(itemCogs * 100) / 100,
          commission: Math.round(itemCommission * 100) / 100,
          customerShipping: Math.round(itemCustomerShipping * 100) / 100,
          shippingCost: Math.round(itemShipping * 100) / 100,
          costCodeDeductions: Math.round(itemCostCodes * 100) / 100,
          netProfit: Math.round(itemNetProfit * 100) / 100,
          commissionSynced: commissionSyncedVal,
        })
      }
    }

    // Flatten wholesale orders
    for (const order of wholesaleOrders) {
      const orderTotal = Number(order.total ?? 0)
      const totalShippingVal = Number(order.shippingCost ?? 0)

      const resByItemId = new Map<string, { productId: string; gradeId: string | null; qtyReserved: number }[]>()
      for (const res of order.inventoryReservations) {
        const list = resByItemId.get(res.salesOrderItemId) ?? []
        list.push(res)
        resByItemId.set(res.salesOrderItemId, list)
      }

      for (const item of order.items) {
        const itemSale = Number(item.total ?? 0)
        const proportion = orderTotal > 0 ? itemSale / orderTotal : 0

        let itemCogs = 0
        let itemCostCodes = 0
        const reservations = resByItemId.get(item.id) ?? []
        for (const res of reservations) {
          const key = `${res.productId}:${res.gradeId ?? ''}`
          itemCogs += (cogsMap.get(key) ?? 0) * res.qtyReserved
          itemCostCodes += (costCodeMap.get(key) ?? 0) * res.qtyReserved
        }

        const itemShipping = totalShippingVal * proportion
        const itemNetProfit = itemSale - itemCogs - itemShipping - itemCostCodes

        lineItemRows.push({
          id: `${order.id}:${item.id}`,
          orderId: order.id,
          olmNumber: null,
          marketplaceOrderId: order.orderNumber,
          source: 'wholesale',
          orderDate: (order.shippedAt ?? order.orderDate).toISOString(),
          asin: null,
          sellerSku: item.sku,
          title: item.title,
          quantity: Number(item.quantity),
          saleValue: Math.round(itemSale * 100) / 100,
          totalCogs: Math.round(itemCogs * 100) / 100,
          commission: 0,
          customerShipping: 0,
          shippingCost: Math.round(itemShipping * 100) / 100,
          costCodeDeductions: Math.round(itemCostCodes * 100) / 100,
          netProfit: Math.round(itemNetProfit * 100) / 100,
          commissionSynced: true,
        })
      }
    }

    finalRows = lineItemRows
  }

  // ── Search filtering ────────────────────────────────────────────────────
  if (search) {
    finalRows = finalRows.filter((r) => {
      const fields = [r.marketplaceOrderId, r.olmNumber != null ? `OLM-${r.olmNumber}` : '', r.source]
      if ('sellerSku' in r) {
        fields.push(r.sellerSku ?? '', r.title ?? '', r.asin ?? '')
      }
      return fields.some((f) => String(f).toLowerCase().includes(search))
    })
  }

  // Sort all rows by date desc
  finalRows.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())

  // Summary (calculated from filtered rows)
  const totalRevenue = finalRows.reduce((s, r) => s + r.saleValue, 0)
  const totalCogs = finalRows.reduce((s, r) => s + r.totalCogs, 0)
  const totalCommission = finalRows.reduce((s, r) => s + r.commission, 0)
  const totalCustomerShipping = finalRows.reduce((s, r) => s + r.customerShipping, 0)
  const totalShipping = finalRows.reduce((s, r) => s + r.shippingCost, 0)
  const totalCostCodes = finalRows.reduce((s, r) => s + r.costCodeDeductions, 0)
  const totalNetProfit = finalRows.reduce((s, r) => s + r.netProfit, 0)

  // Paginate
  const totalCount = finalRows.length
  const paged = finalRows.slice((page - 1) * pageSize, page * pageSize)

  return NextResponse.json({
    rows: paged,
    totalCount,
    page,
    pageSize,
    view,
    summary: {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCogs: Math.round(totalCogs * 100) / 100,
      totalCommission: Math.round(totalCommission * 100) / 100,
      totalCustomerShipping: Math.round(totalCustomerShipping * 100) / 100,
      totalShipping: Math.round(totalShipping * 100) / 100,
      totalCostCodes: Math.round(totalCostCodes * 100) / 100,
      totalNetProfit: Math.round(totalNetProfit * 100) / 100,
    },
  })
}
