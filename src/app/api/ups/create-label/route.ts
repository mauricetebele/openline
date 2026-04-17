import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { generateOutboundLabel, RETURN_ADDRESS, type ReturnLabelRequest } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'

interface CreateLabelBody {
  serviceCode: string
  fromName?: string
  fromPhone?: string | null
  fromAddress1?: string
  fromAddress2?: string | null
  fromCity?: string
  fromState?: string
  fromPostalCode: string
  fromCountry?: string
  toName?: string
  toPhone?: string | null
  toAddress1?: string
  toAddress2?: string | null
  toCity: string
  toState: string
  toPostalCode: string
  toCountry?: string
  weight: { value: number; units: string }
  dimensions: { units: string; length: number; width: number; height: number }
  shipDate?: string
  confirmation?: string
  upsCredentialId?: string
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: CreateLabelBody = await req.json()

  // Convert weight units to UPS format
  let weightUnit: 'LBS' | 'OZS' = 'LBS'
  let weightValue = body.weight.value
  if (/ounce|oz/i.test(body.weight.units)) {
    weightUnit = 'OZS'
  } else if (/gram/i.test(body.weight.units)) {
    weightValue = weightValue / 453.592
  } else if (/kilo/i.test(body.weight.units)) {
    weightValue = weightValue * 2.20462
  }

  const dimUnit: 'IN' | 'CM' = /cent|cm/i.test(body.dimensions.units) ? 'CM' : 'IN'

  const labelReq: ReturnLabelRequest = {
    shipFromName:     body.toName ?? 'Customer',
    shipFromAddress1: body.toAddress1 ?? '',
    shipFromAddress2: body.toAddress2 ?? '',
    shipFromCity:     body.toCity,
    shipFromState:    body.toState,
    shipFromPostal:   body.toPostalCode,
    shipFromCountry:  body.toCountry ?? 'US',
    serviceCode:      body.serviceCode,
    weightValue:      Math.max(weightValue, 0.1),
    weightUnit,
    length:           body.dimensions.length || undefined,
    width:            body.dimensions.width || undefined,
    height:           body.dimensions.height || undefined,
    dimUnit,
    description:      'Outbound Shipment',
    referenceNumber:  undefined,
  }

  try {
    const result = await generateOutboundLabel(labelReq, body.upsCredentialId)
    return NextResponse.json({
      trackingNumber: result.trackingNumber,
      labelData:      result.labelBase64,
      labelFormat:    result.labelFormat,  // 'GIF'
      shipmentCost:   result.shipmentCost ? parseFloat(result.shipmentCost) : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ups/create-label] error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
