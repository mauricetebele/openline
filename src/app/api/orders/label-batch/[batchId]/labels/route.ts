/**
 * GET /api/orders/label-batch/[batchId]/labels
 * Returns all label data for a completed batch (avoids N individual fetches).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { batchId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const batch = await prisma.labelBatch.findUnique({
    where: { id: params.batchId },
    include: {
      items: {
        where: { status: 'COMPLETED' },
        include: {
          order: {
            include: {
              label: { select: { labelData: true, labelFormat: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const labels = batch.items
    .filter(item => item.order.label)
    .map(item => ({
      orderId: item.orderId,
      labelData: item.order.label!.labelData,
      labelFormat: item.order.label!.labelFormat,
    }))

  return NextResponse.json({ labels })
}
