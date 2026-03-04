/**
 * POST /api/orders/[orderId]/bm-serialize
 * Saves serial/IMEI numbers on BackMarket order items.
 *
 * Body: {
 *   items: Array<{
 *     orderItemId: string      // OrderItem.id
 *     serials:     string[]    // one per unit (length must equal quantityOrdered)
 *   }>
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.orderSource !== 'backmarket') {
    return NextResponse.json({ error: 'Not a BackMarket order' }, { status: 400 })
  }

  const { items }: { items: { orderItemId: string; serials: string[] }[] } = await req.json()
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: 'items array is required' }, { status: 400 })
  }

  // Validate each item
  for (const item of items) {
    const orderItem = order.items.find(i => i.id === item.orderItemId)
    if (!orderItem) {
      return NextResponse.json({ error: `Order item ${item.orderItemId} not found` }, { status: 400 })
    }
    if (item.serials.length !== orderItem.quantityOrdered) {
      return NextResponse.json({
        error: `Item "${orderItem.title ?? orderItem.sellerSku}" requires ${orderItem.quantityOrdered} serial(s), got ${item.serials.length}`,
      }, { status: 400 })
    }
    // Check for blanks
    const blanks = item.serials.filter(s => !s.trim())
    if (blanks.length > 0) {
      return NextResponse.json({
        error: `All serial numbers must be non-empty for "${orderItem.title ?? orderItem.sellerSku}"`,
      }, { status: 400 })
    }
  }

  // Check for duplicate serials across all items
  const allSerials = items.flatMap(i => i.serials.map(s => s.trim().toUpperCase()))
  const uniqueSerials = new Set(allSerials)
  if (uniqueSerials.size !== allSerials.length) {
    return NextResponse.json({ error: 'Duplicate serial numbers detected' }, { status: 400 })
  }

  // Save serials to each OrderItem
  await prisma.$transaction(
    items.map(item =>
      prisma.orderItem.update({
        where: { id: item.orderItemId },
        data: { bmSerials: item.serials.map(s => s.trim()) },
      }),
    ),
  )

  return NextResponse.json({ success: true })
}
