import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { loadFedExCredentials, createShipment, type FedExShipmentParams } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

// Minimal blank PDF for test mode (FedEx sandbox works, but we keep this consistent with the rest of the app)
const MOCK_LABEL_PDF_BASE64 =
  'JVBERi0xLjAKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqIDIgMCBv' +
  'YmoKPDwvVHlwZS9QYWdlcy9LaWRzWzMgMCBSXS9Db3VudCAxPj5lbmRvYmogMyAwIG9iago8PC9U' +
  'eXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDI4OCA0MzJdL1BhcmVudCAyIDAgUi9SZXNvdXJjZXM8PC9G' +
  'b250PDwvRjE8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+Pj4+' +
  'Pj4vQ29udGVudHMgNCAwIFI+PmVuZG9iaiA0IDAgb2JqCjw8L0xlbmd0aCAxMDU+PgpzdHJlYW0K' +
  'QlQKL0YxIDI0IFRmCjcyIDM4MCBUZAooVEVTVCBMQUJFTCAtIE5PVCBBIFJFQUwgU0hJUE1FTlQp' +
  'IFRqCi9GMSA5IFRmCjcyIDM2MCBUZAooVGhpcyBsYWJlbCB3YXMgZ2VuZXJhdGVkIGluIHRlc3Qg' +
  'bW9kZSBhbmQgZGlkIG5vdCBjaGFyZ2Ugb3Igc2hpcC4pIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoK' +
  'eHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNj' +
  'EgMDAwMDAgbiAKMDAwMDAwMDExNiAwMDAwMCBuIAowMDAwMDAwMjkzIDAwMDAwIG4gCnRyYWlsZXIK' +
  'PDwvU2l6ZSA1L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKNDUxCiUlRU9G'

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
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creds = await loadFedExCredentials()
  if (!creds) return NextResponse.json({ error: 'FedEx credentials not configured' }, { status: 404 })

  const body: CreateLabelBody = await req.json()

  // Test mode — return mock label without hitting FedEx
  if (body.testLabel) {
    return NextResponse.json({
      trackingNumber: `TEST-FEDEX-${Date.now()}`,
      labelData: MOCK_LABEL_PDF_BASE64,
      labelFormat: 'pdf',
      shipmentCost: 0,
    })
  }

  const weightUnits = /pound|lb/i.test(body.weight.units) ? 'LB' as const : 'KG' as const
  const dimUnits = /inch|in/i.test(body.dimensions.units) ? 'IN' as const : 'CM' as const

  // Convert ounces to pounds for FedEx
  let weightValue = body.weight.value
  if (/ounce|oz/i.test(body.weight.units)) {
    weightValue = Math.round((weightValue / 16) * 100) / 100
  }

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
  }

  try {
    const result = await createShipment(creds, params)
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[fedex/create-label] error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
