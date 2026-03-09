/**
 * GET /api/orders/label-batch/[batchId]
 * Returns the current status of a label batch job.
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
        include: {
          order: { select: { amazonOrderId: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  // Auto-close if stuck RUNNING for over 5 minutes
  if (batch.status === 'RUNNING' && batch.createdAt < new Date(Date.now() - 5 * 60 * 1000)) {
    const timedOut = await prisma.labelBatchItem.updateMany({
      where: { batchId: batch.id, status: { in: ['PENDING', 'RUNNING'] } },
      data:  { status: 'FAILED', error: 'Batch timed out' },
    })
    await prisma.labelBatch.update({
      where: { id: batch.id },
      data:  { status: 'COMPLETED', completedAt: new Date(), failed: { increment: timedOut.count } },
    })
    batch.status = 'COMPLETED'
    batch.failed += timedOut.count
    batch.completedAt = new Date()
    for (const item of batch.items) {
      if (item.status === 'PENDING' || item.status === 'RUNNING') {
        item.status = 'FAILED'
        item.error = 'Batch timed out'
      }
    }
  }

  return NextResponse.json({
    id:          batch.id,
    status:      batch.status,
    isTest:      batch.isTest,
    totalOrders: batch.totalOrders,
    completed:   batch.completed,
    failed:      batch.failed,
    completedAt: batch.completedAt,
    items:       batch.items.map(item => ({
      id:      item.id,
      orderId: item.orderId,
      status:  item.status,
      error:   item.error,
      order:   { amazonOrderId: item.order.amazonOrderId },
    })),
  })
}
