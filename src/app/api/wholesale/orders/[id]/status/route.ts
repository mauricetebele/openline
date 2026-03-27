import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { addDays } from 'date-fns'
import { pushQtyForProducts } from '@/lib/push-qty-for-product'

const TERMS_DAYS: Record<string, number> = {
  NET_15: 15, NET_30: 30, NET_60: 60, NET_90: 90, DUE_ON_RECEIPT: 0,
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING_APPROVAL: ['CONFIRMED'],
  DRAFT:            ['CONFIRMED'],
  CONFIRMED:        ['INVOICED', 'DRAFT'],
  INVOICED:         [],
  PARTIALLY_PAID:   [],
  PAID:             [],
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
  let autoProcessed = false

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

    // Auto-process: check if FG inventory covers all items
    const itemsWithProduct = order.items.filter(i => i.productId)
    if (itemsWithProduct.length > 0) {
      // For each item, find FG inventory
      const reservationPlan: { orderItemId: string; productId: string; locationId: string; qtyReserved: number }[] = []
      let allCovered = true

      for (const item of itemsWithProduct) {
        const qtyNeeded = Math.round(Number(item.quantity))
        const fgInventory = await prisma.inventoryItem.findMany({
          where: {
            productId: item.productId!,
            location: { isFinishedGoods: true },
            ...(item.gradeId ? { gradeId: item.gradeId } : {}),
          },
          include: { location: true },
          orderBy: { qty: 'desc' },
        })

        let remaining = qtyNeeded
        for (const inv of fgInventory) {
          if (remaining <= 0) break
          const take = Math.min(inv.qty, remaining)
          if (take > 0) {
            reservationPlan.push({
              orderItemId: item.id,
              productId: item.productId!,
              locationId: inv.locationId,
              qtyReserved: take,
            })
            remaining -= take
          }
        }

        if (remaining > 0) {
          allCovered = false
          break
        }
      }

      if (allCovered) {
        // Auto-reserve in a transaction (soft reserve — qty NOT decremented until shipped)
        await prisma.$transaction(async tx => {
          for (const r of reservationPlan) {
            await tx.salesOrderInventoryReservation.create({
              data: {
                salesOrderId:     params.id,
                salesOrderItemId: r.orderItemId,
                productId:        r.productId,
                locationId:       r.locationId,
                qtyReserved:      r.qtyReserved,
              },
            })
          }
          await tx.salesOrder.update({
            where: { id: params.id },
            data: { fulfillmentStatus: 'PROCESSING', processedAt: new Date() },
          })
        })

        autoProcessed = true

        // Push updated qty to marketplaces
        const productIds = Array.from(new Set(reservationPlan.map(r => r.productId)))
        pushQtyForProducts(productIds)
      }
      // If not allCovered → fulfillmentStatus stays PENDING for manual process
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
  }

  await prisma.salesOrder.update({
    where: { id: params.id },
    data:  { status: newStatus as never },
  })

  return NextResponse.json({ ok: true, warning, alerts, autoProcessed })
}
