/**
 * POST /api/returns/sync-buyer-notes
 * Scans the returns mailbox (amazonrefunds@openline.us) for Amazon
 * "Return authorization notification" emails and backfills the buyer's note
 * ("Customer's Comment") onto matching MFNReturn rows, so it shows on the
 * order view next to the return reason.
 *
 * Body (all optional):
 *   { newerThanDays?: number, onlyMissing?: boolean, orderIds?: string[] }
 * Defaults to a full scan that refreshes every matched return.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { syncReturnBuyerNotes } from '@/lib/amazon/sync-return-buyer-notes'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    newerThanDays?: number
    onlyMissing?: boolean
    orderIds?: string[]
  }

  const result = await syncReturnBuyerNotes({
    newerThanDays: typeof body.newerThanDays === 'number' ? body.newerThanDays : undefined,
    onlyMissing: body.onlyMissing ?? false,
    orderIds: Array.isArray(body.orderIds) ? body.orderIds : undefined,
  })

  if (!result.ok) return NextResponse.json({ error: result.reason ?? 'Sync failed', ...result }, { status: 400 })
  return NextResponse.json(result)
}
