/**
 * GET  /api/orders/label-batch          — list recent batch history
 * POST /api/orders/label-batch          — create a new batch
 * Body: { orderIds: string[], isTest?: boolean }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { runLabelBatch } from '@/lib/label-batch'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes — batch labels can take a while

const bodySchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1),
  isTest:   z.boolean().optional().default(false),
})

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }

  const { orderIds, isTest } = parsed.data

  // Load PROCESSING orders — only eligible ones proceed
  const candidates = await prisma.order.findMany({
    where: {
      id:             { in: orderIds },
      workflowStatus: 'PROCESSING',
    },
    select: {
      id:               true,
      presetRateId:     true,
      presetRateCarrier: true,
      presetRateError:  true,
      appliedPresetId:  true,
    },
  })

  // Eligible: no rate error AND (has V2 rate ID OR has V1 carrier + preset)
  const eligible = candidates.filter(o =>
    !o.presetRateError &&
    (o.presetRateId != null ||
      (o.presetRateCarrier != null && o.appliedPresetId != null)),
  )

  if (eligible.length === 0) {
    return NextResponse.json(
      { error: 'No eligible orders — ensure orders are in PROCESSING status with a captured rate' },
      { status: 400 },
    )
  }

  const batch = await prisma.labelBatch.create({
    data: {
      isTest,
      totalOrders: eligible.length,
      items: {
        create: eligible.map(o => ({ orderId: o.id })),
      },
    },
  })

  // Fire and forget — continues even if browser disconnects
  runLabelBatch(batch.id).catch(err =>
    console.error('[LabelBatch] batch=%s fatal error:', batch.id, err),
  )

  return NextResponse.json({
    batchId:     batch.id,
    totalOrders: eligible.length,
    skipped:     orderIds.length - eligible.length,
  })
}

export async function GET(_req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Auto-close stale batches stuck in RUNNING for over 5 minutes
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000)
  const staleBatches = await prisma.labelBatch.findMany({
    where: { status: 'RUNNING', createdAt: { lt: staleThreshold } },
    select: { id: true },
  })
  for (const sb of staleBatches) {
    const timedOut = await prisma.labelBatchItem.updateMany({
      where: { batchId: sb.id, status: { in: ['PENDING', 'RUNNING'] } },
      data:  { status: 'FAILED', error: 'Batch timed out' },
    })
    await prisma.labelBatch.update({
      where: { id: sb.id },
      data:  { status: 'COMPLETED', completedAt: new Date(), failed: { increment: timedOut.count } },
    })
  }

  const batches = await prisma.labelBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take:    100,
    include: {
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          id:      true,
          orderId: true,
          status:  true,
          error:   true,
          order:   { select: { amazonOrderId: true, olmNumber: true } },
        },
      },
    },
  })

  return NextResponse.json(batches)
}
