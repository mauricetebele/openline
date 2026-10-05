/**
 * GET /api/orders/[orderId]/refund-eligible
 * Returns the seller-refundable breakdown for an Amazon order so the refund modal
 * can prepopulate the item price WITHOUT tax (and without the regulatory fee).
 * Pulls the true principal from the Finances API; falls back to stored prices.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { getOrderCharges } from '@/lib/amazon/order-charges'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const r2 = (n: number) => Math.round(n * 100) / 100

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orderId } = await params

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      amazonOrderId: true, orderSource: true, currency: true,
      items: { select: { itemPrice: true, itemTax: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.orderSource !== 'amazon') {
    return NextResponse.json({ error: 'Amazon orders only' }, { status: 400 })
  }

  const storedItemPrice = r2(order.items.reduce((s, i) => s + (i.itemPrice ? Number(i.itemPrice) : 0), 0))
  const tax = r2(order.items.reduce((s, i) => s + (i.itemTax ? Number(i.itemTax) : 0), 0))

  // Preferred: the true principal from synced transaction data (excludes the
  // regulatory fee that the Orders API bundles into itemPrice).
  const charges = await getOrderCharges(order.amazonOrderId)
  if (charges.found && charges.principal > 0) {
    // Anything in itemPrice beyond the principal (e.g. a regulatory fee) is not
    // seller-refundable.
    const nonRefundable = r2(Math.max(0, storedItemPrice - charges.principal))
    return NextResponse.json({
      source: 'transactions',
      currency: charges.currency,
      principal: charges.principal,
      tax, shipping: 0, regulatoryFee: nonRefundable,
    })
  }

  // Fallback: stored item price (may include a regulatory fee, so it can slightly
  // over-state the refundable principal — surfaced via source:'stored').
  return NextResponse.json({
    source: 'stored',
    currency: order.currency ?? 'USD',
    principal: storedItemPrice, tax, shipping: 0, regulatoryFee: 0,
  })
}
