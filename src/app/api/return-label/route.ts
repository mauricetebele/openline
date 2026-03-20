/**
 * GET  /api/return-label?amazonOrderId=  — look up buyer address from local DB
 * POST /api/return-label                 — generate UPS return label
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { generateReturnLabel, UPS_SERVICES, ReturnLabelRequest } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const amazonOrderId = req.nextUrl.searchParams.get('amazonOrderId')?.trim()
  if (!amazonOrderId) return NextResponse.json({ error: 'amazonOrderId is required' }, { status: 400 })

  const order = await prisma.order.findFirst({
    where: { amazonOrderId },
    select: {
      id:             true,
      amazonOrderId:  true,
      shipToName:     true,
      shipToAddress1: true,
      shipToAddress2: true,
      shipToCity:     true,
      shipToState:    true,
      shipToPostal:   true,
      shipToCountry:  true,
    },
  })

  if (!order) {
    return NextResponse.json({ error: 'Address does not exist in Database' }, { status: 404 })
  }

  // Require at least a street address to be meaningful
  if (!order.shipToAddress1 || !order.shipToCity || !order.shipToState || !order.shipToPostal) {
    return NextResponse.json({ error: 'Address does not exist in Database' }, { status: 404 })
  }

  return NextResponse.json({
    amazonOrderId: order.amazonOrderId,
    name:     order.shipToName     ?? '',
    address1: order.shipToAddress1 ?? '',
    address2: order.shipToAddress2 ?? '',
    city:     order.shipToCity     ?? '',
    state:    order.shipToState    ?? '',
    postal:   order.shipToPostal   ?? '',
    country:  order.shipToCountry  ?? 'US',
    services: UPS_SERVICES,
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as ReturnLabelRequest & { amazonOrderId?: string; upsCredentialId?: string }

  if (!body.shipFromName?.trim() || !body.shipFromAddress1?.trim() ||
      !body.shipFromCity?.trim() || !body.shipFromState?.trim() || !body.shipFromPostal?.trim()) {
    return NextResponse.json({ error: 'Ship-from address fields are required' }, { status: 400 })
  }
  if (!body.serviceCode) {
    return NextResponse.json({ error: 'Service code is required' }, { status: 400 })
  }
  if (!body.weightValue || body.weightValue <= 0) {
    return NextResponse.json({ error: 'Weight is required' }, { status: 400 })
  }

  try {
    const result = await generateReturnLabel(body, body.upsCredentialId)

    // Persist to history (fire-and-forget — don't fail the request if DB write fails)
    const serviceLabel = (await import('@/lib/ups-tracking')).UPS_SERVICES.find(
      (s: { code: string; label: string }) => s.code === body.serviceCode
    )?.label ?? body.serviceCode

    prisma.returnLabel.create({
      data: {
        amazonOrderId:    (body as ReturnLabelRequest & { amazonOrderId?: string }).amazonOrderId ?? null,
        shipFromName:     body.shipFromName,
        shipFromAddress1: body.shipFromAddress1,
        shipFromCity:     body.shipFromCity,
        shipFromState:    body.shipFromState,
        shipFromPostal:   body.shipFromPostal,
        shipFromCountry:  body.shipFromCountry || 'US',
        serviceCode:      body.serviceCode,
        serviceLabel,
        weightValue:      body.weightValue,
        weightUnit:       body.weightUnit,
        trackingNumber:   result.trackingNumber,
        shipmentId:       result.shipmentId,
        labelData:        result.labelBase64,
        shipmentCost:     result.shipmentCost ? parseFloat(result.shipmentCost) : null,
        currency:         result.currency ?? 'USD',
        upsCredentialId:  body.upsCredentialId ?? null,
      },
    }).catch(err => console.error('[ReturnLabel] DB save failed:', err))

    return NextResponse.json(result)
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Label generation failed' },
      { status: 500 },
    )
  }
}
