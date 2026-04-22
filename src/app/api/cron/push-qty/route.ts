/**
 * GET /api/cron/push-qty — Vercel Cron (every 10 min)
 * Pushes available inventory quantities to all marketplaces for MSKUs with syncQty enabled.
 */
import { NextRequest, NextResponse } from 'next/server'
import { pushAllQuantities } from '@/app/api/marketplace-skus/push-qty/route'

export const maxDuration = 120

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends Authorization: Bearer <CRON_SECRET>)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { results } = await pushAllQuantities()
    const pushed = results.filter((r) => !r.error)
    const errors = results.filter((r) => r.error)

    console.log(`[cron/push-qty] Pushed ${pushed.length} SKUs, ${errors.length} errors`)
    if (errors.length > 0) {
      console.error('[cron/push-qty] Errors:', errors)
    }

    return NextResponse.json({ pushed: pushed.length, errors: errors.length, details: results })
  } catch (err) {
    console.error('[cron/push-qty]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Push failed' },
      { status: 500 },
    )
  }
}
