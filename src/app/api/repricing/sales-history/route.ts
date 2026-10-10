/**
 * GET /api/repricing/sales-history?accountId=&asin=&itemCondition=&days=90
 * Recent Amazon order lines for every SKU in an ASIN + condition group
 * (Repricing Feed "Sales history" popup). Newest first.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { amazonItemCondition } from '@/lib/amazon/competitive-pricing'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const p = req.nextUrl.searchParams
  const accountId = p.get('accountId'), asin = p.get('asin'), itemCondition = p.get('itemCondition')
  const days = Math.min(365, Math.max(1, Number(p.get('days')) || 90))
  if (!accountId || !asin || !itemCondition) return NextResponse.json({ error: 'accountId, asin and itemCondition are required' }, { status: 400 })

  // Every SKU on this ASIN in this condition (incl. currently inactive ones — past sales count).
  const listings = await prisma.sellerListing.findMany({ where: { accountId, asin }, select: { sku: true, condition: true } })
  const skus = listings.filter(l => amazonItemCondition(l.condition) === itemCondition).map(l => l.sku)
  if (skus.length === 0) return NextResponse.json({ days, rows: [] })

  const items = await prisma.orderItem.findMany({
    where: {
      sellerSku: { in: skus },
      order: { orderSource: 'amazon', purchaseDate: { gte: new Date(Date.now() - days * 86_400_000) } },
    },
    select: {
      sellerSku: true, quantityOrdered: true, itemPrice: true,
      order: { select: { id: true, amazonOrderId: true, olmNumber: true, purchaseDate: true, workflowStatus: true, orderStatus: true, fulfillmentChannel: true } },
    },
    orderBy: { order: { purchaseDate: 'desc' } },
    take: 500,
  })

  const rows = items.map(i => {
    const line = i.itemPrice != null ? Number(i.itemPrice) : null // itemPrice is the line total
    const qty = i.quantityOrdered || 1
    return {
      orderId: i.order.id, amazonOrderId: i.order.amazonOrderId, olmNumber: i.order.olmNumber,
      date: i.order.purchaseDate, sku: i.sellerSku, qty,
      unitPrice: line != null ? Math.round(line / qty * 100) / 100 : null, lineTotal: line,
      status: i.order.workflowStatus, amazonStatus: i.order.orderStatus, channel: i.order.fulfillmentChannel,
    }
  })
  return NextResponse.json({ days, rows })
}
