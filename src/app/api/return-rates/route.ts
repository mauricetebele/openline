/**
 * GET /api/return-rates
 *
 * Per-SKU return-rate statistics for marketplace channels (excludes FBA & wholesale).
 * Aggregates shipped MFN orders and received marketplace RMAs to compute return rates.
 *
 * Query params: startDate, endDate, channel (all|amazon|backmarket), groupByGrade
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
  const groupByGrade = searchParams.get('groupByGrade') === 'true'

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

  // ── Product description lookup ──────────────────────────────────────────
  const productTitles = new Map<string, string>()
  const productsWithDesc = await prisma.product.findMany({ select: { id: true, description: true, sku: true } })
  for (const p of productsWithDesc) productTitles.set(p.id, p.description || p.sku)

  // ── Grade name lookup ──────────────────────────────────────────────────
  const gradeNames = new Map<string, string>()
  if (groupByGrade) {
    const grades = await prisma.grade.findMany({ select: { id: true, grade: true } })
    for (const g of grades) gradeNames.set(g.id, g.grade)
  }

  // ── Aggregation bucket ─────────────────────────────────────────────────
  type Bucket = {
    sku: string
    title: string
    grade: string | null
    sources: Set<string>
    unitsSold: number
    unitsReturned: number
    returnReasons: string[]
  }
  const buckets = new Map<string, Bucket>()

  function bucketKey(sku: string, gradeId: string | null): string {
    return groupByGrade && gradeId ? `${sku}::${gradeId}` : sku
  }

  function getOrCreate(sku: string, title: string, source: string, gradeId: string | null): Bucket {
    const key = bucketKey(sku, gradeId)
    let b = buckets.get(key)
    if (!b) {
      b = {
        sku,
        title,
        grade: groupByGrade && gradeId ? (gradeNames.get(gradeId) ?? gradeId) : null,
        sources: new Set(),
        unitsSold: 0,
        unitsReturned: 0,
        returnReasons: [],
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
      include: { items: true },
    })

    for (const order of orders) {
      for (const item of order.items) {
        const sku = item.sellerSku || item.asin || 'UNKNOWN'
        const mapping = item.sellerSku ? skuMap.get(item.sellerSku) : null
        const gradeId = mapping?.gradeId ?? null
        const title = item.title || (mapping ? (productTitles.get(mapping.productId) ?? '') : '')
        const bucket = getOrCreate(sku, title, order.orderSource, gradeId)
        bucket.unitsSold += item.quantityOrdered
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
        order: { select: { orderSource: true } },
      },
    })

    for (const rma of rmas) {
      for (const item of rma.items) {
        const sku = item.sellerSku || item.asin || 'UNKNOWN'
        const mapping = item.sellerSku ? skuMap.get(item.sellerSku) : null
        const gradeId = mapping?.gradeId ?? null
        const title = item.title || (mapping ? (productTitles.get(mapping.productId) ?? '') : '')
        const source = rma.order.orderSource
        const bucket = getOrCreate(sku, title, source, gradeId)
        bucket.unitsReturned += item.quantityReturned
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
