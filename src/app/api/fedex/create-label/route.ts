import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { loadFedExCredentials, createShipment, type FedExShipmentParams } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

interface CreateLabelBody {
  serviceCode: string
  fromName?: string
  fromPhone?: string | null
  fromAddress1?: string
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
  residential?: boolean
  weight: { value: number; units: string }
  dimensions: { units: string; length: number; width: number; height: number }
  shipDate?: string
  testLabel?: boolean
  packagingType?: string  // e.g. 'FEDEX_PAK' — for One Rate labels
  oneRate?: boolean       // when true, adds FEDEX_ONE_RATE special service
  confirmation?: string   // 'none' | 'delivery' | 'signature' | 'adult_signature'
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: CreateLabelBody = await req.json()

  const creds = await loadFedExCredentials(body.testLabel)
  if (!creds) return NextResponse.json({ error: body.testLabel ? 'FedEx sandbox credentials not configured — add them in Settings' : 'FedEx credentials not configured' }, { status: 404 })

  const weightUnits = /pound|lb/i.test(body.weight.units) ? 'LB' as const : 'KG' as const
  const dimUnits = /inch|in/i.test(body.dimensions.units) ? 'IN' as const : 'CM' as const

  // Convert ounces to pounds for FedEx
  let weightValue = body.weight.value
  if (/ounce|oz/i.test(body.weight.units)) {
    weightValue = Math.round((weightValue / 16) * 100) / 100
  }

  // Map confirmation to FedEx signature type
  const confirmationToSignature: Record<string, import('@/lib/fedex/client').FedExSignatureType> = {
    signature: 'DIRECT',
    adult_signature: 'ADULT',
    delivery: 'INDIRECT',
  }
  const fedexSignatureType = body.confirmation ? confirmationToSignature[body.confirmation] : undefined

  const params: FedExShipmentParams = {
    shipFrom: {
      streetLines: body.fromAddress1 ? [body.fromAddress1] : [],
      city: body.fromCity ?? '',
      stateOrProvinceCode: body.fromState ?? '',
      postalCode: body.fromPostalCode,
      countryCode: body.fromCountry ?? 'US',
      personName: body.fromName ?? 'Warehouse',
      phone: body.fromPhone ?? '555-555-5555',
    },
    shipTo: {
      streetLines: [body.toAddress1 ?? '', ...(body.toAddress2 ? [body.toAddress2] : [])].filter(Boolean),
      city: body.toCity,
      stateOrProvinceCode: body.toState,
      postalCode: body.toPostalCode,
      countryCode: body.toCountry ?? 'US',
      residential: body.residential,
      personName: body.toName ?? 'Customer',
      phone: body.toPhone ?? '555-555-5555',
    },
    weight: { value: weightValue, units: weightUnits },
    dimensions: { length: body.dimensions.length, width: body.dimensions.width, height: body.dimensions.height, units: dimUnits },
    serviceType: body.serviceCode,
    shipDate: body.shipDate,
    ...(body.packagingType ? { packagingType: body.packagingType } : {}),
    ...(body.oneRate ? { oneRate: true } : {}),
    ...(fedexSignatureType ? { signatureType: fedexSignatureType } : {}),
  }

  try {
    const result = await createShipment(creds, params, body.testLabel)
    return NextResponse.json({ ...result, isTest: !!body.testLabel })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[fedex/create-label] error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
