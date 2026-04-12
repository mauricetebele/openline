/**
 * GET /api/return-rates
 *
 * Per-SKU return-rate statistics for marketplace channels (excludes FBA & wholesale).
 * Aggregates shipped MFN orders and received marketplace RMAs to compute return rates.
 *
 * Query params: startDate, endDate, channel (all|amazon|backmarket)
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
  const channel = searchParams.get('channel') || 'all'

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  const dateFrom = new Date(startDate + 'T00:00:00Z')
  const dateTo = new Date(endDate + 'T23:59:59.999Z')

  // ── SKU → product+grade mapping ────────────────────────────────────────
  const skuMap = new Map<string, { productId: string; gradeId: string | null }>()
  const allProducts = await prisma.product.findMany({ select: { id: true, sku: true } })
  for (const p of allProducts) skuMap.set(p.sku, { productId: p.id, gradeId: null })
  const mskuRows = await prisma.productGradeMarketplaceSku.findMany({
    select: { sellerSku: true, productId: true, gradeId: true },
  })
  for (const m of mskuRows) skuMap.set(m.sellerSku, { productId: m.productId, gradeId: m.gradeId })

  // ── Product lookup (internal SKU + description) ────────────────────────
  const productSkus = new Map<string, string>()   // productId → internal SKU
  const productTitles = new Map<string, string>()  // productId → description
  const productsWithDesc = await prisma.product.findMany({ select: { id: true, description: true, sku: true } })
  for (const p of productsWithDesc) {
    productSkus.set(p.id, p.sku)
    productTitles.set(p.id, p.description || p.sku)
  }

  // ── Grade name lookup (always loaded) ─────────────────────────────────
  const gradeNames = new Map<string, string>()
  const grades = await prisma.grade.findMany({ select: { id: true, grade: true } })
  for (const g of grades) gradeNames.set(g.id, g.grade)

  // ── Aggregation bucket ─────────────────────────────────────────────────
  type OrderDetail = {
    orderId: string
    amazonOrderId: string
    qty: number
    source: string
    date: string | null
  }
  type Bucket = {
    sku: string
    title: string
    grade: string | null
    sources: Set<string>
    unitsSold: number
    unitsReturned: number
    returnReasons: string[]
    soldOrders: OrderDetail[]
    returnedOrders: OrderDetail[]
  }
  const buckets = new Map<string, Bucket>()

  function bucketKey(sku: string, gradeId: string | null): string {
    return gradeId ? `${sku}::${gradeId}` : sku
  }

  function getOrCreate(sku: string, title: string, source: string, gradeId: string | null): Bucket {
    const key = bucketKey(sku, gradeId)
    let b = buckets.get(key)
    if (!b) {
      b = {
        sku,
        title,
        grade: gradeId ? (gradeNames.get(gradeId) ?? gradeId) : null,
        sources: new Set(),
        unitsSold: 0,
        unitsReturned: 0,
        returnReasons: [],
        soldOrders: [],
        returnedOrders: [],
      }
      buckets.set(key, b)
    }
    b.sources.add(source)
    if (!b.title && title) b.title = title
    return b
  }

  // ── Fetch shipped marketplace orders (MFN only, no FBA) ────────────────
  {
    const marketplaceWhere: Prisma.OrderWhereInput = {
      workflowStatus: 'SHIPPED',
      fulfillmentChannel: { not: 'AFN' },
      OR: [
        { shippedAt: { gte: dateFrom, lte: dateTo } },
        { shippedAt: null, purchaseDate: { gte: dateFrom, lte: dateTo } },
      ],
    }
    if (channel === 'amazon') marketplaceWhere.orderSource = 'amazon'
    if (channel === 'backmarket') marketplaceWhere.orderSource = 'backmarket'

    const orders = await prisma.order.findMany({
      where: marketplaceWhere,
      include: {
        items: true,
        serialAssignments: {
          select: { orderItemId: true, inventorySerial: { select: { gradeId: true } } },
        },
      },
    })

    for (const order of orders) {
      // Build orderItemId → gradeId from serial assignments
      const serialGradeByItem = new Map<string, string>()
      for (const sa of order.serialAssignments) {
        if (sa.inventorySerial.gradeId) {
          serialGradeByItem.set(sa.orderItemId, sa.inventorySerial.gradeId)
        }
      }

      for (const item of order.items) {
        const mapping = item.sellerSku ? skuMap.get(item.sellerSku) : null
        const internalSku = mapping ? (productSkus.get(mapping.productId) ?? item.sellerSku ?? 'UNKNOWN') : (item.sellerSku || item.asin || 'UNKNOWN')
        // Use grade from SKU mapping first, fall back to serial assignment grade
        const gradeId = mapping?.gradeId ?? serialGradeByItem.get(item.id) ?? null
        const title = item.title || (mapping ? (productTitles.get(mapping.productId) ?? '') : '')
        const bucket = getOrCreate(internalSku, title, order.orderSource, gradeId)
        bucket.unitsSold += item.quantityOrdered
        bucket.soldOrders.push({
          orderId: order.id,
          amazonOrderId: order.amazonOrderId,
          qty: item.quantityOrdered,
          source: order.orderSource,
          date: (order.shippedAt ?? order.purchaseDate)?.toISOString().slice(0, 10) ?? null,
        })
      }
    }
  }

  // ── Fetch marketplace RMAs (RECEIVED only, MFN only) ──────────────────
  {
    // Date filter on the PARENT ORDER's ship date, not the RMA creation date
    const rmaOrderFilter: Prisma.OrderWhereInput = {
      workflowStatus: 'SHIPPED',
      fulfillmentChannel: { not: 'AFN' },
      OR: [
        { shippedAt: { gte: dateFrom, lte: dateTo } },
        { shippedAt: null, purchaseDate: { gte: dateFrom, lte: dateTo } },
      ],
    }
    if (channel === 'amazon') rmaOrderFilter.orderSource = 'amazon'
    if (channel === 'backmarket') rmaOrderFilter.orderSource = 'backmarket'

    const rmaWhere: Prisma.MarketplaceRMAWhereInput = {
      status: 'RECEIVED',
      order: rmaOrderFilter,
    }

    const rmas = await prisma.marketplaceRMA.findMany({
      where: rmaWhere,
      include: {
        items: true,
        order: {
          select: {
            id: true,
            amazonOrderId: true,
            orderSource: true,
            shippedAt: true,
            purchaseDate: true,
            serialAssignments: {
              select: { orderItemId: true, inventorySerial: { select: { gradeId: true } } },
            },
          },
        },
      },
    })

    for (const rma of rmas) {
      // Build orderItemId → gradeId from parent order's serial assignments
      const serialGradeByItem = new Map<string, string>()
      for (const sa of rma.order.serialAssignments) {
        if (sa.inventorySerial.gradeId) {
          serialGradeByItem.set(sa.orderItemId, sa.inventorySerial.gradeId)
        }
      }

      for (const item of rma.items) {
        const mapping = item.sellerSku ? skuMap.get(item.sellerSku) : null
        const internalSku = mapping ? (productSkus.get(mapping.productId) ?? item.sellerSku ?? 'UNKNOWN') : (item.sellerSku || item.asin || 'UNKNOWN')
        // Use grade from SKU mapping first, fall back to serial assignment grade
        const gradeId = mapping?.gradeId ?? serialGradeByItem.get(item.orderItemId) ?? null
        const title = item.title || (mapping ? (productTitles.get(mapping.productId) ?? '') : '')
        const source = rma.order.orderSource
        const bucket = getOrCreate(internalSku, title, source, gradeId)
        bucket.unitsReturned += item.quantityReturned
        bucket.returnedOrders.push({
          orderId: rma.orderId,
          amazonOrderId: rma.order.amazonOrderId,
          qty: item.quantityReturned,
          source,
          date: rma.createdAt?.toISOString().slice(0, 10) ?? null,
        })
        if (item.returnReason) bucket.returnReasons.push(item.returnReason)
      }
    }
  }

  // ── Build output rows ──────────────────────────────────────────────────
  const rows = Array.from(buckets.values()).map((b) => {
    const sources = Array.from(b.sources)
    const returnRate = b.unitsSold > 0 ? (b.unitsReturned / b.unitsSold) * 100 : 0

    // Find top return reason by frequency
    const reasonCounts = new Map<string, number>()
    for (const r of b.returnReasons) {
      reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1)
    }
    let topReason = ''
    let topCount = 0
    reasonCounts.forEach((count, reason) => {
      if (count > topCount) { topReason = reason; topCount = count }
    })

    return {
      sku: b.sku,
      title: b.title,
      grade: b.grade,
      channel: sources.length === 1 ? sources[0] : 'mixed',
      unitsSold: b.unitsSold,
      unitsReturned: b.unitsReturned,
      returnRate: Math.round(returnRate * 10) / 10,
      topReturnReason: topReason,
      soldOrders: b.soldOrders,
      returnedOrders: b.returnedOrders,
    }
  })

  // Sort by return rate desc
  rows.sort((a, b) => b.returnRate - a.returnRate)

  // Summary
  const totalSold = rows.reduce((s, r) => s + r.unitsSold, 0)
  const totalReturned = rows.reduce((s, r) => s + r.unitsReturned, 0)
  const summary = {
    unitsSold: totalSold,
    unitsReturned: totalReturned,
    returnRate: totalSold > 0 ? Math.round((totalReturned / totalSold) * 1000) / 10 : 0,
    uniqueSkus: rows.length,
  }

  return NextResponse.json({ summary, rows })
}
