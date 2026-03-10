/**
 * GET /api/profitability/:orderId?source=amazon|backmarket|wholesale
 *
 * Returns per-line-item profitability breakdown for a single order.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { Prisma } from '@prisma/client'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params
  const source = req.nextUrl.searchParams.get('source') ?? 'amazon'

  // ── COGS map ────────────────────────────────────────────────────────────
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

  if (source === 'wholesale') {
    return handleWholesale(orderId, cogsMap)
  }

  return handleMarketplace(orderId, cogsMap)
}

async function handleMarketplace(
  orderId: string,
  cogsMap: Map<string, number>,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      label: { select: { shipmentCost: true } },
      reservations: { select: { productId: true, gradeId: true, qtyReserved: true, orderItemId: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const orderTotal = Number(order.orderTotal ?? 0)
  const totalCommission = Number(order.marketplaceCommission ?? 0)
  const totalShipping = Number(order.label?.shipmentCost ?? 0)

  // Build reservation map keyed by orderItemId
  const resByItemId = new Map<string, { productId: string; gradeId: string | null; qtyReserved: number }[]>()
  for (const res of order.reservations) {
    const list = resByItemId.get(res.orderItemId) ?? []
    list.push(res)
    resByItemId.set(res.orderItemId, list)
  }

  const itemCount = order.items.length

  const lineItems = order.items.map((item) => {
    // Include tax in sale value to match orderTotal (which includes tax)
    const itemSale = Number(item.itemPrice ?? 0) + Number(item.itemTax ?? 0)
    const proportion = itemCount === 1 ? 1 : (orderTotal > 0 ? itemSale / orderTotal : 0)

    // COGS from reservations for this line item
    let itemCogs = 0
    const reservations = resByItemId.get(item.id) ?? []
    for (const res of reservations) {
      const key = `${res.productId}:${res.gradeId ?? ''}`
      const unitCost = cogsMap.get(key) ?? 0
      itemCogs += unitCost * res.qtyReserved
    }

    const itemCommission = totalCommission * proportion
    const itemShipping = totalShipping * proportion
    const itemNetProfit = itemSale - itemCogs - itemCommission - itemShipping

    return {
      id: item.id,
      orderItemId: item.orderItemId,
      asin: item.asin,
      sellerSku: item.sellerSku,
      title: item.title,
      quantity: item.quantityOrdered,
      saleValue: Math.round(itemSale * 100) / 100,
      cogs: Math.round(itemCogs * 100) / 100,
      commission: Math.round(itemCommission * 100) / 100,
      shipping: Math.round(itemShipping * 100) / 100,
      netProfit: Math.round(itemNetProfit * 100) / 100,
    }
  })

  return NextResponse.json({ lineItems })
}

async function handleWholesale(
  orderId: string,
  cogsMap: Map<string, number>,
) {
  const order = await prisma.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      inventoryReservations: { select: { productId: true, gradeId: true, qtyReserved: true, salesOrderItemId: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const orderTotal = Number(order.total ?? 0)
  const totalShipping = Number(order.shippingCost ?? 0)

  // Build reservation map keyed by salesOrderItemId
  const resByItemId = new Map<string, { productId: string; gradeId: string | null; qtyReserved: number }[]>()
  for (const res of order.inventoryReservations) {
    const list = resByItemId.get(res.salesOrderItemId) ?? []
    list.push(res)
    resByItemId.set(res.salesOrderItemId, list)
  }

  const lineItems = order.items.map((item) => {
    const itemSale = Number(item.total ?? 0)
    const proportion = orderTotal > 0 ? itemSale / orderTotal : 0

    let itemCogs = 0
    const reservations = resByItemId.get(item.id) ?? []
    for (const res of reservations) {
      const key = `${res.productId}:${res.gradeId ?? ''}`
      const unitCost = cogsMap.get(key) ?? 0
      itemCogs += unitCost * res.qtyReserved
    }

    const itemShipping = totalShipping * proportion
    const itemNetProfit = itemSale - itemCogs - itemShipping

    return {
      id: item.id,
      orderItemId: item.id,
      asin: null,
      sellerSku: item.sku,
      title: item.title,
      quantity: Number(item.quantity),
      saleValue: Math.round(itemSale * 100) / 100,
      cogs: Math.round(itemCogs * 100) / 100,
      commission: 0,
      shipping: Math.round(itemShipping * 100) / 100,
      netProfit: Math.round(itemNetProfit * 100) / 100,
    }
  })

  return NextResponse.json({ lineItems })
}
