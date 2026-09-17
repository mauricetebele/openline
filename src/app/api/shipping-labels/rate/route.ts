/**
 * POST /api/shipping-labels/rate
 * Quote a manual multi-piece shipment without buying. Body = ManualLabelInput.
 * Returns { total, currency }.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { parseManualLabelInput, rateManualShipment } from '@/lib/shipping-labels'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  try {
    const input = parseManualLabelInput(body)
    const rate = await rateManualShipment(input)
    return NextResponse.json(rate)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Rate failed' }, { status: 400 })
  }
}
