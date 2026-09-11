import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search')?.trim()
  const status = searchParams.get('status')
  const source = searchParams.get('source')?.toLowerCase()

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  // Filter by marketplace (the parent order's source)
  if (source === 'amazon' || source === 'backmarket') where.order = { orderSource: source }

  // Date-range filter on the RMA date (createdAt), inclusive.
  const from = searchParams.get('from')?.trim()
  const to = searchParams.get('to')?.trim()
  if (from || to) {
    const range: Record<string, Date> = {}
    if (from) { const d = new Date(`${from}T00:00:00`); if (!isNaN(d.getTime())) range.gte = d }
    if (to) { const d = new Date(`${to}T23:59:59.999`); if (!isNaN(d.getTime())) range.lte = d }
    if (Object.keys(range).length) where.createdAt = range
  }
  if (search) {
    where.OR = [
      { rmaNumber: { contains: search, mode: 'insensitive' } },
      { order: { shipToName: { contains: search, mode: 'insensitive' } } },
      { order: { amazonOrderId: { contains: search, mode: 'insensitive' } } },
      { items: { some: { sellerSku: { contains: search, mode: 'insensitive' } } } },
      { items: { some: { product: { sku: { contains: search, mode: 'insensitive' } } } } },
      { items: { some: { serials: { some: { serialNumber: { contains: search, mode: 'insensitive' } } } } } },
    ]
  }

  const rmas = await prisma.marketplaceRMA.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      order: {
        select: {
          id: true,
          olmNumber: true,
          amazonOrderId: true,
          orderSource: true,
          shipToName: true,
        },
      },
      items: {
        select: {
          id: true,
          sellerSku: true,
          title: true,
          quantityReturned: true,
          returnReason: true,
          orderItem: { select: { itemPrice: true, quantityOrdered: true } },
          product: { select: { sku: true } },
          serials: {
            select: {
              id: true,
              serialNumber: true,
              receivedAt: true,
              note: true,
              location: { select: { name: true, warehouse: { select: { name: true } } } },
              grade: { select: { grade: true } },
            },
          },
        },
      },
    },
  })

  // For BackMarket returns, look up any commission-refund entry
  // (invoice_key 'avoir_sales_fees') in the BM financials for the order, so the
  // grid can show whether the commission was refunded and how much.
  const bmOrderIds = Array.from(new Set(
    rmas
      .filter(r => r.order?.orderSource === 'backmarket' && r.order?.amazonOrderId)
      .map(r => r.order!.amazonOrderId),
  ))
  const commissionRefundMap = new Map<string, number>()
  if (bmOrderIds.length > 0) {
    const refundRows = await prisma.$queryRaw<{ order_id: string; amount: number }[]>`
      SELECT order_id, SUM(amount)::float8 AS amount
      FROM bm_billing_entries
      WHERE invoice_key = 'avoir_sales_fees' AND order_id = ANY(${bmOrderIds}::text[])
      GROUP BY order_id`
    for (const row of refundRows) commissionRefundMap.set(row.order_id, Number(row.amount))
  }

  const data = rmas.map(r => {
    // Sale value of the returned units: per item, (line itemPrice ÷ qty ordered)
    // × qty returned, summed across items.
    const saleValue = r.items.reduce((sum, it) => {
      const line = it.orderItem?.itemPrice != null ? Number(it.orderItem.itemPrice) : 0
      const ordered = it.orderItem?.quantityOrdered ?? 0
      const unit = ordered > 0 ? line / ordered : line
      return sum + unit * (it.quantityReturned ?? 0)
    }, 0)
    return {
      ...r,
      saleValue: Math.round(saleValue * 100) / 100,
      commissionRefund: r.order?.orderSource === 'backmarket'
        ? (commissionRefundMap.get(r.order.amazonOrderId) ?? null)
        : null,
    }
  })

  // Commission-refund filter (BackMarket returns only): keep those that have a
  // commission-refund entry, or those that don't.
  const commission = searchParams.get('commission')
  const filtered =
    commission === 'refunded'
      ? data.filter(r => r.order?.orderSource === 'backmarket' && r.commissionRefund != null)
      : commission === 'not_refunded'
        ? data.filter(r => r.order?.orderSource === 'backmarket' && r.commissionRefund == null)
        : data

  const totalSaleValue = Math.round(filtered.reduce((s, r) => s + (r.saleValue ?? 0), 0) * 100) / 100

  return NextResponse.json({ data: filtered, totalSaleValue })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { orderId, notes, items } = body as {
    orderId: string
    notes?: string
    items: Array<{
      orderItemId: string
      productId?: string
      sellerSku?: string
      asin?: string
      title?: string
      quantityReturned: number
      returnReason?: string
      serials?: Array<{ serialNumber: string; inventorySerialId?: string }>
    }>
  }

  if (!orderId) return NextResponse.json({ error: 'Order is required' }, { status: 400 })
  if (!items?.length) return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })

  // Validate order is SHIPPED
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, workflowStatus: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.workflowStatus !== 'SHIPPED') {
    return NextResponse.json({ error: 'Order must be in SHIPPED status' }, { status: 400 })
  }

  // Validate serials belong to this order
  for (const item of items) {
    if (!item.serials?.length) continue
    for (const s of item.serials) {
      if (!s.inventorySerialId) continue
      const assignment = await prisma.orderSerialAssignment.findFirst({
        where: {
          orderId,
          orderItemId: item.orderItemId,
          inventorySerialId: s.inventorySerialId,
        },
      })
      if (!assignment) {
        return NextResponse.json(
          { error: `Serial ${s.serialNumber} is not assigned to this order item` },
          { status: 400 },
        )
      }
    }
  }

  // ── Prevent duplicate returns for the same item/serial on this order ──
  const orderItemIds = Array.from(new Set(items.map(i => i.orderItemId)))

  // (a) Serial-level: a specific unit already returned on this order can't be returned again.
  const newInvSerialIds = items.flatMap(i => (i.serials ?? []).map(s => s.inventorySerialId?.trim()).filter(Boolean) as string[])
  const newSerialNumbers = items.flatMap(i => (i.serials ?? []).map(s => s.serialNumber?.trim()).filter(Boolean) as string[])
  if (newInvSerialIds.length || newSerialNumbers.length) {
    const dup = await prisma.marketplaceRMASerial.findFirst({
      where: {
        rmaItem: { rma: { orderId } },
        OR: [
          ...(newInvSerialIds.length ? [{ inventorySerialId: { in: newInvSerialIds } }] : []),
          ...(newSerialNumbers.length ? [{ serialNumber: { in: newSerialNumbers } }] : []),
        ],
      },
      include: { rmaItem: { include: { rma: { select: { rmaNumber: true } } } } },
    })
    if (dup) {
      return NextResponse.json(
        { error: `A return already exists for serial ${dup.serialNumber} on this order (${dup.rmaItem.rma.rmaNumber}).` },
        { status: 409 },
      )
    }
  }

  // (b) Quantity-level: returns already logged for an order item can't exceed the ordered qty.
  const existingRmaItems = await prisma.marketplaceRMAItem.findMany({
    where: { orderItemId: { in: orderItemIds }, rma: { orderId } },
    select: { orderItemId: true, quantityReturned: true },
  })
  const returnedByItem = new Map<string, number>()
  for (const e of existingRmaItems) returnedByItem.set(e.orderItemId, (returnedByItem.get(e.orderItemId) ?? 0) + e.quantityReturned)

  if (returnedByItem.size > 0) {
    const orderItems = await prisma.orderItem.findMany({
      where: { id: { in: orderItemIds } },
      select: { id: true, quantityOrdered: true, sellerSku: true, title: true },
    })
    const orderedById = new Map(orderItems.map(o => [o.id, o]))
    const requestedByItem = new Map<string, number>()
    for (const i of items) requestedByItem.set(i.orderItemId, (requestedByItem.get(i.orderItemId) ?? 0) + (i.quantityReturned ?? 0))

    for (const [oiId, requested] of Array.from(requestedByItem.entries())) {
      const already = returnedByItem.get(oiId) ?? 0
      if (already <= 0) continue
      const oi = orderedById.get(oiId)
      const ordered = oi?.quantityOrdered ?? 0
      if (already + requested > ordered) {
        const label = oi?.sellerSku ?? oi?.title ?? 'this item'
        return NextResponse.json(
          { error: `A return already exists for ${label} on this order (${already} of ${ordered} already returned). Creating this return would exceed the ordered quantity.` },
          { status: 409 },
        )
      }
    }
  }

  // Auto-generate rmaNumber: MP-RMA-0001
  const last = await prisma.marketplaceRMA.findFirst({ orderBy: { createdAt: 'desc' } })
  let nextNum = 1
  if (last) {
    const match = last.rmaNumber.match(/MP-RMA-(\d+)/)
    if (match) nextNum = parseInt(match[1], 10) + 1
  }
  const rmaNumber = `MP-RMA-${String(nextNum).padStart(4, '0')}`

  try {
    const rma = await prisma.marketplaceRMA.create({
      data: {
        rmaNumber,
        orderId,
        notes: notes?.trim() || null,
        items: {
          create: items.map((item) => ({
            orderItemId: item.orderItemId,
            productId: item.productId?.trim() || null,
            sellerSku: item.sellerSku?.trim() || null,
            asin: item.asin?.trim() || null,
            title: item.title?.trim() || null,
            quantityReturned: item.quantityReturned,
          returnReason: item.returnReason?.trim() || null,
            serials: item.serials?.length
              ? {
                  create: item.serials.map((s) => ({
                    serialNumber: s.serialNumber,
                    inventorySerialId: s.inventorySerialId?.trim() || null,
                  })),
                }
              : undefined,
          })),
        },
      },
      include: {
        order: {
          select: {
            id: true,
            olmNumber: true,
            amazonOrderId: true,
            orderSource: true,
            shipToName: true,
          },
        },
        items: {
          include: {
            serials: true,
          },
        },
      },
    })

    return NextResponse.json(rma, { status: 201 })
  } catch (err) {
    console.error('[MP-RMA Create] Error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
