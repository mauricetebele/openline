import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { loadFedExCredentials, getRates, type FedExRateParams } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

interface RateShopBody {
  fromPostalCode: string
  fromCity?: string
  fromState?: string
  fromCountry?: string
  toPostalCode: string
  toCity: string
  toState: string
  toCountry?: string
  residential?: boolean
  weight: { value: number; units: string }
  dimensions: { units: string; length: number; width: number; height: number }
  shipDate?: string
  testMode?: boolean
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: RateShopBody = await req.json()

  const creds = await loadFedExCredentials(body.testMode)
  if (!creds) return NextResponse.json({ error: body.testMode ? 'FedEx sandbox credentials not configured — add them in Settings' : 'FedEx credentials not configured' }, { status: 404 })

  const weightUnits = /pound|lb/i.test(body.weight.units) ? 'LB' as const : 'KG' as const
  const dimUnits = /inch|in/i.test(body.dimensions.units) ? 'IN' as const : 'CM' as const

  // Convert ounces to pounds for FedEx
  let weightValue = body.weight.value
  if (/ounce|oz/i.test(body.weight.units)) {
    weightValue = Math.round((weightValue / 16) * 100) / 100
  }

  const params: FedExRateParams = {
    shipFrom: {
      streetLines: [],
      city: body.fromCity ?? '',
      stateOrProvinceCode: body.fromState ?? '',
      postalCode: body.fromPostalCode,
      countryCode: body.fromCountry ?? 'US',
    },
    shipTo: {
      streetLines: [],
      city: body.toCity,
      stateOrProvinceCode: body.toState,
      postalCode: body.toPostalCode,
      countryCode: body.toCountry ?? 'US',
      residential: body.residential,
    },
    weight: { value: weightValue, units: weightUnits },
    dimensions: { length: body.dimensions.length, width: body.dimensions.width, height: body.dimensions.height, units: dimUnits },
    shipDate: body.shipDate,
  }

  try {
    const rates = await getRates(creds, params, body.testMode)
    return NextResponse.json({ rates })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[fedex/rate-shop] error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
