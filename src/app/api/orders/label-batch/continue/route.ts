/**
 * POST /api/orders/label-batch/continue
 *
 * Runs the label batch processor and keeps the function alive until done.
 * Called by the client after creating a batch, and by the processor itself
 * when approaching the Vercel execution time limit (chaining).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { runLabelBatch } from '@/lib/label-batch'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  // Accept either auth user or internal secret
  const secret = req.headers.get('x-batch-secret')
  const user = await getAuthUser()
  if (!user && secret !== (process.env.BATCH_CHAIN_SECRET || 'internal')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { batchId } = (await req.json()) as { batchId: string }
  if (!batchId) {
    return NextResponse.json({ error: 'Missing batchId' }, { status: 400 })
  }

  console.log('[LabelBatch] processing triggered for batch=%s', batchId)

  // AWAIT the batch — this keeps the serverless function alive for up to maxDuration
  try {
    await runLabelBatch(batchId)
  } catch (err) {
    console.error('[LabelBatch] batch=%s fatal error:', batchId, err)
    return NextResponse.json({ error: 'Batch processing failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, batchId })
}
