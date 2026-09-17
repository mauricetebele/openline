/**
 * POST /api/fba-shipments/[id]/sync-tracking
 *
 * Re-pulls per-box tracking numbers from Amazon and stores them, so they appear
 * on the Live Shipping Manifest (one row per box tracking number).
 *
 * Returns: { updated, total, tracked }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { syncFbaTracking } from '@/lib/amazon/fba-tracking'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await syncFbaTracking(params.id)
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }
  return NextResponse.json(result)
}
