/**
 * POST /api/orders/label-batch/continue
 *
 * Internal endpoint called by the label-batch processor when it's
 * approaching the Vercel execution time limit. Spawns a new function
 * invocation to continue processing remaining PENDING items.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runLabelBatch } from '@/lib/label-batch'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  // Simple shared-secret check to prevent external abuse
  const secret = req.headers.get('x-batch-secret')
  if (secret !== (process.env.BATCH_CHAIN_SECRET || 'internal')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { batchId } = (await req.json()) as { batchId: string }
  if (!batchId) {
    return NextResponse.json({ error: 'Missing batchId' }, { status: 400 })
  }

  console.log('[LabelBatch] continuation triggered for batch=%s', batchId)

  // Fire and forget — continues processing remaining PENDING items
  runLabelBatch(batchId).catch(err =>
    console.error('[LabelBatch] continuation batch=%s fatal error:', batchId, err),
  )

  return NextResponse.json({ ok: true, batchId })
}
