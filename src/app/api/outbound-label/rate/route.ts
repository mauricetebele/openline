/**
 * POST /api/outbound-label/rate
 * Get a UPS rate quote for an outbound shipment without purchasing a label.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { getOutboundRateQuote, ReturnLabelRequest } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as ReturnLabelRequest & { upsCredentialId?: string }

  if (!body.shipFromAddress1?.trim() || !body.shipFromCity?.trim() ||
      !body.shipFromState?.trim() || !body.shipFromPostal?.trim()) {
    return NextResponse.json({ error: 'Ship-to address is required' }, { status: 400 })
  }
  if (!body.serviceCode) {
    return NextResponse.json({ error: 'Service code is required' }, { status: 400 })
  }
  if (!body.weightValue || body.weightValue <= 0) {
    return NextResponse.json({ error: 'Weight is required' }, { status: 400 })
  }

  try {
    const result = await getOutboundRateQuote(body, body.upsCredentialId)
    return NextResponse.json(result)
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Rate quote failed' },
      { status: 500 },
    )
  }
}
