/**
 * PATCH /api/wholesale/orders/[id]/line-price
 *
 * Change the sale (unit) price of a single line item on an ALREADY-INVOICED
 * wholesale order (INVOICED / PARTIALLY_PAID / PAID). The normal edit PUT blocks
 * these statuses and rebuilds line items destructively; this updates one line's
 * price in place and recomputes the order totals + AR balance/status correctly.
 *
 * Body: { itemId: string, unitPrice: number }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// Canonical wholesale totals (mirrors calcTotals in the create/invoice routes).
function calcTotals(
  items: Array<{ quantity: number; unitPrice: number; taxable: boolean }>,
  discountPct: number,
  taxRate: number,
  shippingCost: number,
) {
  const lineItems = items.map((i) => ({ ...i, lineTotal: i.quantity * i.unitPrice }))
  const subtotal = lineItems.reduce((s, i) => s + i.lineTotal, 0)
  const discountAmt = subtotal * (discountPct / 100)
  const afterDiscount = subtotal - discountAmt
  const taxableAmt = lineItems.filter((i) => i.taxable).reduce((s, i) => s + i.lineTotal, 0)
    - (lineItems.filter((i) => i.taxable).reduce((s, i) => s + i.lineTotal, 0) / subtotal || 0) * discountAmt
  const taxAmt = taxableAmt * (taxRate / 100)
  const total = afterDiscount + taxAmt + shippingCost
  return { subtotal, discountAmt, taxAmt, total }
}

const INVOICED_STATUSES = ['INVOICED', 'PARTIALLY_PAID', 'PAID'] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const itemId = typeof body?.itemId === 'string' ? body.itemId : ''
  const unitPrice = typeof body?.unitPrice === 'number' ? body.unitPrice : parseFloat(String(body?.unitPrice ?? ''))
  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return NextResponse.json({ error: 'A valid non-negative unit price is required' }, { status: 400 })
  }

  const order = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: { items: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!INVOICED_STATUSES.includes(order.status as typeof INVOICED_STATUSES[number])) {
    return NextResponse.json(
      { error: 'This action is only for invoiced orders. Edit unapproved orders from the Edit screen.' },
      { status: 400 },
    )
  }
  const target = order.items.find((i) => i.id === itemId)
  if (!target) return NextResponse.json({ error: 'Line item not found on this order' }, { status: 404 })

  const roundedPrice = Math.round(unitPrice * 100) / 100
  const oldPrice = Number(target.unitPrice)
  const newLineTotal = Math.round(Number(target.quantity) * roundedPrice * 100) / 100

  // Recompute order totals from all items with the new price.
  const recomputed = calcTotals(
    order.items.map((i) => ({
      quantity: Number(i.quantity),
      unitPrice: i.id === itemId ? roundedPrice : Number(i.unitPrice),
      taxable: i.taxable,
    })),
    Number(order.discountPct),
    Number(order.taxRate),
    Number(order.shippingCost),
  )
  const round2 = (n: number) => Math.round(n * 100) / 100
  const total = round2(recomputed.total)
  const paidAmount = Number(order.paidAmount)
  const balance = round2(total - paidAmount)

  // Keep accounting status consistent with the new balance so AR aggregations
  // (which count INVOICED/PARTIALLY_PAID, not PAID) stay correct.
  let status = order.status
  if (paidAmount <= 0) status = 'INVOICED'
  else if (balance <= 0.005) status = 'PAID'
  else status = 'PARTIALLY_PAID'

  const updated = await prisma.$transaction(async (tx) => {
    await tx.salesOrderItem.update({
      where: { id: itemId },
      data: { unitPrice: roundedPrice, total: newLineTotal },
    })
    return tx.salesOrder.update({
      where: { id: order.id },
      data: {
        subtotal: round2(recomputed.subtotal),
        discountAmt: round2(recomputed.discountAmt),
        taxAmt: round2(recomputed.taxAmt),
        total,
        balance,
        status,
      },
      include: { items: { orderBy: { createdAt: 'asc' } }, customer: { select: { id: true, companyName: true } } },
    })
  })

  await logAuditEvent({
    entityType: 'salesOrder',
    entityId: order.id,
    action: 'wholesale_line_price_changed',
    before: { itemId, sku: target.sku, unitPrice: oldPrice, orderTotal: Number(order.total), balance: Number(order.balance), status: order.status },
    after: { itemId, unitPrice: roundedPrice, orderTotal: total, balance, status },
    actorId: user.dbId,
    actorLabel: user.email,
  }).catch((e) => console.error('[line-price] audit log failed:', e))

  return NextResponse.json({ success: true, order: updated })
}
