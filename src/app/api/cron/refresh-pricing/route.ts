/**
 * GET /api/cron/refresh-pricing  (Vercel cron, every 30 min)
 * Refreshes live price + listing status + Buy Box / BackBox for all sync-enabled
 * marketplace SKUs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { refreshAllPricing } from '@/lib/marketplace-pricing-refresh'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await refreshAllPricing()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'refresh failed' }, { status: 500 })
  }
}
