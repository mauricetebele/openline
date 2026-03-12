/**
 * GET /api/cron/reconcile-qty — Vercel Cron (daily at midnight)
 * Auto-heals any inventory qty drift by reconciling against serial counts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { reconcileSerialQty } from '@/lib/reconcile-serial-qty'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await reconcileSerialQty(false)
  console.log(`[cron/reconcile-qty] checked=${result.checked} mismatches=${result.mismatches.length} fixed=${result.fixed}`)

  return NextResponse.json(result)
}
