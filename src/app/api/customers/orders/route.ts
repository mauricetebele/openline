/**
 * GET /api/customers/orders?key=ws:{customerId}
 *                          ?key={lower(name)}|{lower(postal)}   (Amazon)
 *
 * Returns order history for a unified customer entry.
 *
 * For wholesale customers (key starts with "ws:"): returns SalesOrders.
 * For Amazon/marketplace customers (key = "name|postal"): returns Orders
 *   matching shipToName + shipToPostal (case-insensitive).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = req.nextUrl.searchParams.get('key')?.trim()
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 })

  // ── Wholesale customer ──────────────────────────────────────────────────────
  if (key.startsWith('ws:')) {
    const customerId = key.slice(3)

    const [customer, orders] = await Promise.all([
      prisma.wholesaleCustomer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          companyName: true,
          contactName: true,
          email: true,
          phone: true,
          paymentTerms: true,
        },
      }),
      prisma.salesOrder.findMany({
        where: { customerId },
        orderBy: { orderDate: 'desc' },
        include: {
          items: {
            select: {
              id: true,
              sku: true,
              title: true,
              quantity: true,
              unitPrice: true,
              total: true,
            },
          },
        },
      }),
    ])

    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    return NextResponse.json({
      type: 'wholesale',
      customer,
      orders: orders.map(o => ({
        id:          o.id,
        orderNumber: o.orderNumber,
        orderDate:   o.orderDate.toISOString(),
        dueDate:     o.dueDate?.toISOString() ?? null,
        status:      o.status,
        subtotal:    o.subtotal,
        total:       o.total,
        balance:     o.balance,
        paymentTerms: o.paymentTerms,
        items:       o.items,
      })),
    })
  }

  // ── Amazon / marketplace customer ──────────────────────────────────────────
  // key format: lower(shipToName)|lower(shipToPostal)
  const pipeIdx = key.lastIndexOf('|')
  if (pipeIdx === -1) return NextResponse.json({ error: 'Invalid key format' }, { status: 400 })

  const shipToName   = key.slice(0, pipeIdx)
  const shipToPostal = key.slice(pipeIdx + 1)

  const orders = await prisma.order.findMany({
    where: {
      shipToName:   { equals: shipToName,   mode: 'insensitive' },
      shipToPostal: { equals: shipToPostal, mode: 'insensitive' },
    },
    orderBy: { purchaseDate: 'desc' },
    include: {
      account: { select: { marketplaceName: true } },
      items: {
        select: {
          id: true,
          amazonOrderItemId: true,
          sellerSku: true,
          title: true,
          quantityOrdered: true,
          itemPrice: true,
        },
      },
    },
  })

  const customerName = orders[0]?.shipToName ?? shipToName

  return NextResponse.json({
    type: 'amazon',
    customer: {
      name:  customerName,
      city:  orders[0]?.shipToCity  ?? null,
      state: orders[0]?.shipToState ?? null,
      zip:   orders[0]?.shipToPostal ?? null,
      phone: orders[0]?.shipToPhone  ?? null,
    },
    orders: orders.map(o => ({
      id:             o.id,
      amazonOrderId:  o.amazonOrderId,
      purchaseDate:   o.purchaseDate?.toISOString() ?? null,
      orderStatus:    o.orderStatus,
      workflowStatus: o.workflowStatus,
      orderTotal:     o.orderTotal,
      marketplace:    o.account.marketplaceName,
      shipToCity:     o.shipToCity,
      shipToState:    o.shipToState,
      items:          o.items,
    })),
  })
}
