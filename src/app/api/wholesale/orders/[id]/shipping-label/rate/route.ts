/**
 * POST /api/wholesale/orders/[id]/shipping-label/rate
 * Rate a multi-piece outbound shipment (all boxes) without buying. Same body as
 * the label POST; returns { total, currency }. Ship-from = our warehouse.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { getUpsMultiPieceRate, RETURN_ADDRESS, type MultiPieceAddress, type MultiPiecePackage } from '@/lib/ups-tracking'
import { loadFedExCredentials, getMultiPieceRate } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

interface PackageInput { weightValue: number; weightUnit: 'LBS' | 'OZS'; length?: number; width?: number; height?: number; dimUnit?: 'IN' | 'CM' }

export async function POST(req: NextRequest, { params: _params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    carrier?: 'UPS' | 'FEDEX'
    upsCredentialId?: string
    shipFromName?: string; shipFromCompany?: string; shipFromAddress1?: string; shipFromAddress2?: string
    shipFromCity?: string; shipFromState?: string; shipFromPostal?: string; shipFromCountry?: string
    shipToPhone?: string
    serviceCode?: string
    packages?: PackageInput[]
  }
  const carrier = body.carrier === 'FEDEX' ? 'FEDEX' : 'UPS'
  const packages = Array.isArray(body.packages) ? body.packages : []
  const toName = body.shipFromName?.trim() || body.shipFromCompany?.trim() || ''

  if (!toName || !body.shipFromAddress1?.trim() || !body.shipFromCity?.trim() || !body.shipFromState?.trim() || !body.shipFromPostal?.trim()) {
    return NextResponse.json({ error: 'Ship-to address is incomplete' }, { status: 400 })
  }
  if (!body.serviceCode) return NextResponse.json({ error: 'Select a service' }, { status: 400 })
  if (packages.length === 0 || !packages.every(p => Number(p.weightValue) > 0)) {
    return NextResponse.json({ error: 'Enter a weight for each box' }, { status: 400 })
  }

  const shipFrom: MultiPieceAddress = {
    name: RETURN_ADDRESS.name, company: RETURN_ADDRESS.name,
    address1: RETURN_ADDRESS.line1, address2: RETURN_ADDRESS.line2,
    city: RETURN_ADDRESS.city, state: RETURN_ADDRESS.state, postal: RETURN_ADDRESS.postal, country: RETURN_ADDRESS.country,
  }
  const shipTo: MultiPieceAddress = {
    name: toName, company: body.shipFromCompany?.trim() || undefined,
    address1: body.shipFromAddress1!.trim(), address2: body.shipFromAddress2?.trim() || undefined,
    city: body.shipFromCity!.trim(), state: body.shipFromState!.trim(), postal: body.shipFromPostal!.trim(),
    country: body.shipFromCountry?.trim() || 'US', phone: body.shipToPhone?.trim() || undefined,
  }
  const serviceCode = body.serviceCode

  try {
    if (carrier === 'FEDEX') {
      const creds = await loadFedExCredentials()
      if (!creds) return NextResponse.json({ error: 'FedEx credentials not configured' }, { status: 400 })
      const rate = await getMultiPieceRate(creds, {
        shipFrom: { streetLines: [RETURN_ADDRESS.line1, RETURN_ADDRESS.line2].filter(Boolean) as string[], city: RETURN_ADDRESS.city, stateOrProvinceCode: RETURN_ADDRESS.state, postalCode: RETURN_ADDRESS.postal, countryCode: RETURN_ADDRESS.country, personName: RETURN_ADDRESS.name, phone: '0000000000' },
        shipTo: { streetLines: [shipTo.address1, shipTo.address2].filter(Boolean) as string[], city: shipTo.city, stateOrProvinceCode: shipTo.state.slice(0, 2), postalCode: shipTo.postal, countryCode: shipTo.country, personName: shipTo.name, phone: '0000000000' },
        packages: packages.map(p => ({ weight: { value: p.weightUnit === 'OZS' ? Number(p.weightValue) / 16 : Number(p.weightValue), units: 'LB' }, ...(p.length && p.width && p.height ? { dimensions: { length: Number(p.length), width: Number(p.width), height: Number(p.height), units: p.dimUnit === 'CM' ? 'CM' : 'IN' } } : {}) })),
        serviceType: serviceCode,
      })
      return NextResponse.json(rate)
    }
    const upsPackages: MultiPiecePackage[] = packages.map(p => ({
      weightValue: Number(p.weightValue), weightUnit: p.weightUnit === 'OZS' ? 'OZS' : 'LBS',
      length: p.length ? Number(p.length) : undefined, width: p.width ? Number(p.width) : undefined,
      height: p.height ? Number(p.height) : undefined, dimUnit: p.dimUnit === 'CM' ? 'CM' : 'IN',
    }))
    const rate = await getUpsMultiPieceRate({ shipFrom, shipTo, serviceCode, packages: upsPackages }, body.upsCredentialId)
    return NextResponse.json(rate)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Rate request failed' }, { status: 502 })
  }
}
