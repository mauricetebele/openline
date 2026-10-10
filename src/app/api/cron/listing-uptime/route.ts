/**
 * GET /api/cron/listing-uptime — Vercel Cron (every 30 min)
 * Checks Amazon for each relevant SKU's live state (BUYABLE + qty > 0) and logs
 * up/down transitions — the repricing feed's "live window" source of truth.
 */
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { checkListingUptime } from '@/lib/amazon/listing-uptime'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const r = await checkListingUptime({ budgetMs: 210_000 })
  console.log('[cron/listing-uptime]', JSON.stringify(r))
  return NextResponse.json({ status: 'success', ...r })
}
