/**
 * POST /api/orders/[orderId]/reinstate
 * Moves a CANCELLED order back to PENDING.
 * Inventory is NOT automatically re-reserved; the user must process the order again.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where:  { id: params.orderId },
    select: { workflowStatus: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.workflowStatus !== 'CANCELLED') {
    return NextResponse.json({ error: 'Only CANCELLED orders can be reinstated' }, { status: 409 })
  }

  await prisma.order.update({
    where: { id: params.orderId },
    data:  { workflowStatus: 'PENDING' },
  })

  return NextResponse.json({ success: true })
}
