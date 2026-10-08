/**
 * GET /api/cs-cases/[id] — one case: thread (messages + timestamps + attachments),
 * status, and the linked marketplace order's details if the case's orderId matches
 * an order. Marks the case read for the viewer's side.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const CAN_ACCESS = (role: string) => role === 'ADMIN' || role === 'MARKETPLACE_CS'

async function loadLinkedOrder(orderId: string | null) {
  if (!orderId) return null
  const order = await prisma.order.findFirst({
    where: { amazonOrderId: orderId, orderSource: { in: ['amazon', 'backmarket'] } },
    orderBy: { purchaseDate: 'desc' },
    select: {
      amazonOrderId: true, olmNumber: true, orderSource: true, purchaseDate: true,
      workflowStatus: true, orderTotal: true, currency: true,
      shipToName: true, shipToCity: true, shipToState: true,
      shipCarrier: true, shipTracking: true,
      label: { select: { carrier: true, trackingNumber: true } },
      items: { select: { sellerSku: true, title: true, quantityOrdered: true, itemPrice: true }, orderBy: { orderItemId: 'asc' } },
    },
  })
  if (!order) return null
  return {
    amazonOrderId: order.amazonOrderId,
    olmNumber: order.olmNumber,
    orderSource: order.orderSource,
    purchaseDate: order.purchaseDate,
    workflowStatus: order.workflowStatus,
    orderTotal: order.orderTotal != null ? Number(order.orderTotal) : null,
    currency: order.currency,
    shipToName: order.shipToName,
    shipToCity: order.shipToCity,
    shipToState: order.shipToState,
    carrier: order.label?.carrier ?? order.shipCarrier ?? null,
    trackingNumber: order.label?.trackingNumber ?? order.shipTracking ?? null,
    items: order.items.map(i => ({
      sku: i.sellerSku, title: i.title, quantity: i.quantityOrdered,
      itemPrice: i.itemPrice != null ? Number(i.itemPrice) : null,
    })),
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_ACCESS(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const c = await prisma.csCase.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      resolvedBy: { select: { name: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, role: true } } },
      },
    },
  })
  if (!c) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  const isAdmin = user.role === 'ADMIN'
  if (!isAdmin && c.createdById !== user.dbId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Mark read for the viewer's side.
  await prisma.csCase.update({
    where: { id },
    data: isAdmin ? { adminReadAt: new Date() } : { agentReadAt: new Date() },
  }).catch(() => {})

  const linkedOrder = await loadLinkedOrder(c.orderId)

  return NextResponse.json({
    case: {
      id: c.id,
      caseNumber: c.caseNumber,
      orderId: c.orderId,
      status: c.status,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
      resolvedAt: c.resolvedAt,
      resolvedByName: c.resolvedBy?.name ?? null,
      messages: c.messages.map(m => ({
        id: m.id,
        body: m.body,
        attachments: (m.attachments as unknown as { url: string; filename: string; contentType: string; size: number }[] | null) ?? [],
        createdAt: m.createdAt,
        author: m.author,
        isAdmin: m.author.role === 'ADMIN',
      })),
    },
    linkedOrder,
  })
}
