/**
 * POST /api/repair-orders/[id]/relocate
 * Move this repair order's units into the vendor's mapped in-repair location and
 * log the repair-shipment activity. Used to back-fill orders that shipped out
 * before the vendor's location was mapped. Idempotent — units already there are
 * left alone.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { recordRepairShipment } from '@/lib/repair-location'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await recordRepairShipment(params.id, 'outbound', user.dbId)
    if (!result.locationName) {
      return NextResponse.json({ error: 'This vendor has no in-repair location mapped. Set one on the Vendors tab first.' }, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Relocate failed' }, { status: 500 })
  }
}
