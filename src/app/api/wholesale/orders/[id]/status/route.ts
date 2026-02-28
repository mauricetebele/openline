import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { addDays } from 'date-fns'

const TERMS_DAYS: Record<string, number> = {
  NET_15: 15, NET_30: 30, NET_60: 60, NET_90: 90, DUE_ON_RECEIPT: 0,
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT:          ['CONFIRMED', 'VOID'],
  CONFIRMED:      ['INVOICED', 'DRAFT', 'VOID'],
  INVOICED:       ['VOID'],
  PARTIALLY_PAID: ['VOID'],
  PAID:           [],
  VOID:           [],
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { newStatus } = await req.json()

  const order = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      items: { include: { product: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const allowed = VALID_TRANSITIONS[order.status] ?? []
  if (!allowed.includes(newStatus)) {
    return NextResponse.json(
      { error: `Cannot transition from ${order.status} to ${newStatus}` },
      { status: 400 },
    )
  }

  let warning: string | null = null
  const alerts: string[] = []

  if (newStatus === 'CONFIRMED') {
    // Credit limit check
    if (order.customer.creditLimit !== null) {
      const openBalance = await prisma.salesOrder.aggregate({
        where: {
          customerId: order.customerId,
          status: { in: ['INVOICED', 'PARTIALLY_PAID', 'CONFIRMED'] },
          id: { not: order.id },
        },
        _sum: { balance: true },
      })
      const existingOpen = Number(openBalance._sum.balance ?? 0)
      const orderTotal   = Number(order.total)
      const creditLimit  = Number(order.customer.creditLimit)
      if (existingOpen + orderTotal > creditLimit) {
        warning = `This order will exceed the credit limit of $${creditLimit.toFixed(2)}. Current open balance: $${existingOpen.toFixed(2)}.`
      }
    }
  }

  if (newStatus === 'INVOICED') {
    // Set dueDate if not set
    if (!order.dueDate) {
      const terms   = order.customer.paymentTerms
      const daysOut = TERMS_DAYS[terms] ?? 30
      await prisma.salesOrder.update({
        where: { id: params.id },
        data:  { dueDate: addDays(order.orderDate, daysOut) },
      })
    }

    // Deduct inventory for items with productId
    for (const item of order.items) {
      if (!item.productId) continue
      const qtyNeeded = Number(item.quantity)

      // Find inventory locations sorted by qty desc
      const invItems = await prisma.inventoryItem.findMany({
        where: { productId: item.productId },
        orderBy: { qty: 'desc' },
      })

      let remaining = qtyNeeded
      for (const inv of invItems) {
        if (remaining <= 0) break
        const deduct = Math.min(inv.qty, remaining)
        await prisma.inventoryItem.update({
          where: { id: inv.id },
          data:  { qty: inv.qty - deduct },
        })
        remaining -= deduct
      }

      if (remaining > 0) {
        alerts.push(
          `Insufficient stock for ${item.sku ?? item.title}: needed ${qtyNeeded}, short by ${remaining}`,
        )
      }
    }
  }

  await prisma.salesOrder.update({
    where: { id: params.id },
    data:  { status: newStatus as never },
  })

  return NextResponse.json({ ok: true, warning, alerts })
}
