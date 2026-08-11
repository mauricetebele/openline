/**
 * POST /api/vendor-rma/[id]/labels/quote — rate a shipment before purchase.
 * Same body as the buy endpoint; returns { total, currency } without buying.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { getUpsMultiPieceRate, type MultiPieceAddress, type MultiPiecePackage } from '@/lib/ups-tracking'
import { loadFedExCredentials, getMultiPieceRate } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }
interface PackageInput { weightValue: number; weightUnit: 'LBS' | 'OZS'; length?: number; width?: number; height?: number; dimUnit?: 'IN' | 'CM' }

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { carrier, upsCredentialId, warehouseId, serviceCode, shipTo, packages, testMode } = body as {
    carrier: 'ups' | 'fedex'; upsCredentialId?: string; warehouseId: string; serviceCode: string
    shipTo: { name?: string; company?: string; address1?: string; address2?: string; city?: string; state?: string; postal?: string; country?: string; phone?: string }
    packages: PackageInput[]; testMode?: boolean
  }

  if (carrier !== 'ups' && carrier !== 'fedex') return NextResponse.json({ error: 'carrier must be ups or fedex' }, { status: 400 })
  if (!warehouseId || !serviceCode) return NextResponse.json({ error: 'Select a warehouse and service' }, { status: 400 })
  if (!Array.isArray(packages) || packages.length === 0) return NextResponse.json({ error: 'Add at least one package' }, { status: 400 })
  if (!shipTo?.address1?.trim() || !shipTo?.city?.trim() || !shipTo?.state?.trim() || !shipTo?.postal?.trim()) {
    return NextResponse.json({ error: 'Ship-to address is incomplete' }, { status: 400 })
  }

  const wh = await prisma.warehouse.findUnique({ where: { id: warehouseId } })
  if (!wh) return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
  if (!wh.addressLine1?.trim() || !wh.city?.trim() || !wh.state?.trim() || !wh.postalCode?.trim()) {
    return NextResponse.json({ error: `Warehouse "${wh.name}" is missing a shipping address.` }, { status: 400 })
  }

  const company = wh.companyName?.trim() || wh.name
  const shipFrom: MultiPieceAddress = {
    name: company, company, address1: wh.addressLine1, address2: wh.addressLine2 ?? undefined,
    city: wh.city, state: wh.state, postal: wh.postalCode, country: wh.countryCode ?? 'US', phone: wh.phone ?? undefined,
  }
  const shipToAddr: MultiPieceAddress = {
    name: shipTo.name?.trim() || shipTo.company?.trim() || 'Vendor Returns', company: shipTo.company?.trim() || undefined,
    address1: shipTo.address1!.trim(), address2: shipTo.address2?.trim() || undefined,
    city: shipTo.city!.trim(), state: shipTo.state!.trim(), postal: shipTo.postal!.trim(), country: shipTo.country?.trim() || 'US', phone: shipTo.phone?.trim() || undefined,
  }

  try {
    if (carrier === 'ups') {
      const upsPackages: MultiPiecePackage[] = packages.map(p => ({
        weightValue: Number(p.weightValue), weightUnit: p.weightUnit === 'OZS' ? 'OZS' : 'LBS',
        length: p.length ? Number(p.length) : undefined, width: p.width ? Number(p.width) : undefined,
        height: p.height ? Number(p.height) : undefined, dimUnit: p.dimUnit === 'CM' ? 'CM' : 'IN',
      }))
      const rate = await getUpsMultiPieceRate({ shipFrom, shipTo: shipToAddr, serviceCode, packages: upsPackages }, upsCredentialId)
      return NextResponse.json(rate)
    }
    const creds = await loadFedExCredentials(testMode)
    if (!creds) return NextResponse.json({ error: 'FedEx is not configured.' }, { status: 400 })
    const rate = await getMultiPieceRate(creds, {
      shipFrom: { streetLines: [wh.addressLine1, wh.addressLine2].filter(Boolean) as string[], city: wh.city, stateOrProvinceCode: wh.state, postalCode: wh.postalCode, countryCode: wh.countryCode ?? 'US', personName: company, phone: '0000000000' },
      shipTo: { streetLines: [shipToAddr.address1, shipToAddr.address2].filter(Boolean) as string[], city: shipToAddr.city, stateOrProvinceCode: shipToAddr.state, postalCode: shipToAddr.postal, countryCode: shipToAddr.country, personName: shipToAddr.name, phone: '0000000000' },
      packages: packages.map(p => ({ weight: { value: p.weightUnit === 'OZS' ? Number(p.weightValue) / 16 : Number(p.weightValue), units: 'LB' }, ...(p.length && p.width && p.height ? { dimensions: { length: Number(p.length), width: Number(p.width), height: Number(p.height), units: p.dimUnit === 'CM' ? 'CM' : 'IN' } } : {}) })),
      serviceType: serviceCode,
    }, testMode)
    return NextResponse.json(rate)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Rate request failed' }, { status: 502 })
  }
}
