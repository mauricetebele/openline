/**
 * GET /api/tracking/status?tracking=xxx
 * Live carrier status for any UPS / FedEx tracking number (USPS requires a Web
 * Tools account and returns a friendly error). Used by the order view to show the
 * outbound shipment's live status.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { getCarrierStatus } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tracking = req.nextUrl.searchParams.get('tracking')?.trim()
  if (!tracking) return NextResponse.json({ error: 'tracking is required' }, { status: 400 })

  try {
    const result = await getCarrierStatus(tracking)
    return NextResponse.json({
      status: result.status,
      deliveredAt: result.deliveredAt,
      estimatedDelivery: result.estimatedDelivery,
    })
  } catch (err) {
    // Surface as a soft error so the UI can show "tracking unavailable" inline.
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Tracking lookup failed' })
  }
}
