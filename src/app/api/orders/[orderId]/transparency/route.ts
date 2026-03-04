/**
 * POST /api/orders/[orderId]/transparency
 * Save transparency codes for order items that require them.
 * Body: { items: [{ orderItemId: string, codes: string[] }] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

interface TransparencyItemInput {
  orderItemId: string
  codes: string[]
}

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orderId } = params
    const body = await req.json()
    const { items } = body as { items: TransparencyItemInput[] }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 })
    }

    // Load order with items
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    // Validate each submitted item
    const errors: string[] = []
    const updates: { orderItemId: string; codes: string[] }[] = []

    for (const input of items) {
      const orderItem = order.items.find(i => i.orderItemId === input.orderItemId)
      if (!orderItem) {
        errors.push(`Order item ${input.orderItemId} not found`)
        continue
      }
      if (!orderItem.isTransparency) {
        errors.push(`Order item ${input.orderItemId} does not require transparency codes`)
        continue
      }
      if (!Array.isArray(input.codes) || input.codes.length !== orderItem.quantityOrdered) {
        errors.push(
          `Item ${orderItem.sellerSku ?? input.orderItemId}: expected ${orderItem.quantityOrdered} code(s), got ${input.codes?.length ?? 0}`,
        )
        continue
      }
      // Validate codes are non-empty strings
      const trimmed = input.codes.map(c => c.trim())
      if (trimmed.some(c => c.length === 0)) {
        errors.push(`Item ${orderItem.sellerSku ?? input.orderItemId}: all codes must be non-empty`)
        continue
      }
      updates.push({ orderItemId: input.orderItemId, codes: trimmed })
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
    }

    // Save codes to each order item
    await prisma.$transaction(
      updates.map(u =>
        prisma.orderItem.update({
          where: {
            orderId_orderItemId: { orderId, orderItemId: u.orderItemId },
          },
          data: { transparencyCodes: u.codes },
        }),
      ),
    )

    return NextResponse.json({ success: true, itemsUpdated: updates.length })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/orders/[orderId]/transparency]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
