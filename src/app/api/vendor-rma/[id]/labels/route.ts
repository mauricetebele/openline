/**
 * GET  /api/vendor-rma/[id]/labels  — list purchased label sets for an RTV
 * POST /api/vendor-rma/[id]/labels  — buy a multi-piece label set (UPS or FedEx)
 *
 * Ship-from = a selected warehouse; ship-to = the vendor RMA address. One POST
 * buys a set of N packages (one label per piece); an RTV can hold many sets from
 * different carriers. Each piece is its own row (and its own manifest entry).
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { generateUpsMultiPieceLabels, UPS_SERVICES, type MultiPieceAddress, type MultiPiecePackage } from '@/lib/ups-tracking'
import { loadFedExCredentials, createMultiPieceShipment } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

interface PackageInput {
  weightValue: number
  weightUnit: 'LBS' | 'OZS'
  length?: number
  width?: number
  height?: number
  dimUnit?: 'IN' | 'CM'
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const labels = await prisma.vendorReturnLabel.findMany({
    where: { vendorRmaId: params.id },
    orderBy: [{ createdAt: 'desc' }, { pieceNumber: 'asc' }],
  })
  return NextResponse.json({ data: labels.map(l => ({ ...l, shipmentCost: l.shipmentCost != null ? Number(l.shipmentCost) : null })) })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    carrier, upsCredentialId, warehouseId, serviceCode, shipTo, packages, confirmation, testMode,
  } = body as {
    carrier: 'ups' | 'fedex'
    upsCredentialId?: string
    warehouseId: string
    serviceCode: string
    shipTo: { name?: string; company?: string; address1?: string; address2?: string; city?: string; state?: string; postal?: string; country?: string; phone?: string }
    packages: PackageInput[]
    confirmation?: 'none' | 'delivery' | 'signature' | 'adult_signature'
    testMode?: boolean
  }

  if (carrier !== 'ups' && carrier !== 'fedex') return NextResponse.json({ error: 'carrier must be ups or fedex' }, { status: 400 })
  if (!warehouseId) return NextResponse.json({ error: 'Select a ship-from warehouse' }, { status: 400 })
  if (!serviceCode) return NextResponse.json({ error: 'Select a service' }, { status: 400 })
  if (!Array.isArray(packages) || packages.length === 0) return NextResponse.json({ error: 'Add at least one package' }, { status: 400 })
  for (let i = 0; i < packages.length; i++) {
    if (!(Number(packages[i].weightValue) > 0)) return NextResponse.json({ error: `Package ${i + 1}: weight must be greater than 0` }, { status: 400 })
  }
  if (!shipTo?.address1?.trim() || !shipTo?.city?.trim() || !shipTo?.state?.trim() || !shipTo?.postal?.trim()) {
    return NextResponse.json({ error: 'Ship-to address is incomplete (address, city, state, postal required)' }, { status: 400 })
  }

  const rma = await prisma.vendorRMA.findUnique({ where: { id: params.id }, select: { id: true, rmaNumber: true } })
  if (!rma) return NextResponse.json({ error: 'Vendor RMA not found' }, { status: 404 })

  const wh = await prisma.warehouse.findUnique({ where: { id: warehouseId } })
  if (!wh) return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
  if (!wh.addressLine1?.trim() || !wh.city?.trim() || !wh.state?.trim() || !wh.postalCode?.trim()) {
    return NextResponse.json({ error: `Warehouse "${wh.name}" is missing a shipping address — add it on the Warehouses page.` }, { status: 400 })
  }

  const shipFromCompany = wh.companyName?.trim() || wh.name
  const shipFrom: MultiPieceAddress = {
    name: shipFromCompany, company: shipFromCompany,
    address1: wh.addressLine1, address2: wh.addressLine2 ?? undefined,
    city: wh.city, state: wh.state, postal: wh.postalCode, country: wh.countryCode ?? 'US', phone: wh.phone ?? undefined,
  }
  const shipToAddr: MultiPieceAddress = {
    name: shipTo.name?.trim() || shipTo.company?.trim() || 'Vendor Returns',
    company: shipTo.company?.trim() || undefined,
    address1: shipTo.address1!.trim(), address2: shipTo.address2?.trim() || undefined,
    city: shipTo.city!.trim(), state: shipTo.state!.trim(), postal: shipTo.postal!.trim(), country: shipTo.country?.trim() || 'US',
    phone: shipTo.phone?.trim() || undefined,
  }

  // Normalized pieces + set metadata built per carrier.
  let shipmentId: string | null = null
  let shipmentCost: number | null = null
  let currency = 'USD'
  let serviceLabel: string | null = null
  let pieces: { trackingNumber: string; labelData: string; labelFormat: string }[] = []

  try {
    if (carrier === 'ups') {
      const upsPackages: MultiPiecePackage[] = packages.map(p => ({
        weightValue: Number(p.weightValue), weightUnit: p.weightUnit === 'OZS' ? 'OZS' : 'LBS',
        length: p.length ? Number(p.length) : undefined, width: p.width ? Number(p.width) : undefined,
        height: p.height ? Number(p.height) : undefined, dimUnit: p.dimUnit === 'CM' ? 'CM' : 'IN',
      }))
      const result = await generateUpsMultiPieceLabels({
        shipFrom, shipTo: shipToAddr, serviceCode, packages: upsPackages, confirmation,
        referenceNumber: rma.rmaNumber, description: `Vendor Return ${rma.rmaNumber}`,
      }, upsCredentialId)
      shipmentId = result.shipmentId
      shipmentCost = result.shipmentCost != null ? Number(result.shipmentCost) : null
      currency = result.currency ?? 'USD'
      serviceLabel = UPS_SERVICES.find(s => s.code === serviceCode)?.label ?? null
      pieces = result.pieces.map(p => ({ trackingNumber: p.trackingNumber, labelData: p.labelBase64, labelFormat: p.labelFormat }))
    } else {
      const creds = await loadFedExCredentials(testMode)
      if (!creds) return NextResponse.json({ error: 'FedEx is not configured. Add credentials in Settings → FedEx.' }, { status: 400 })
      const fx = await createMultiPieceShipment(creds, {
        shipFrom: {
          streetLines: [wh.addressLine1, wh.addressLine2].filter(Boolean) as string[],
          city: wh.city, stateOrProvinceCode: wh.state, postalCode: wh.postalCode, countryCode: wh.countryCode ?? 'US',
          personName: shipFromCompany, phone: (wh.phone ?? '').replace(/[^0-9]/g, '') || '0000000000',
        },
        shipTo: {
          streetLines: [shipToAddr.address1, shipToAddr.address2].filter(Boolean) as string[],
          city: shipToAddr.city, stateOrProvinceCode: shipToAddr.state, postalCode: shipToAddr.postal, countryCode: shipToAddr.country,
          personName: shipToAddr.name, phone: (shipToAddr.phone ?? '').replace(/[^0-9]/g, '') || '0000000000',
        },
        packages: packages.map(p => ({
          weight: { value: p.weightUnit === 'OZS' ? Number(p.weightValue) / 16 : Number(p.weightValue), units: 'LB' },
          ...(p.length && p.width && p.height ? { dimensions: { length: Number(p.length), width: Number(p.width), height: Number(p.height), units: p.dimUnit === 'CM' ? 'CM' : 'IN' } } : {}),
        })),
        serviceType: serviceCode,
        reference: rma.rmaNumber,
      }, testMode)
      shipmentId = fx.masterTrackingNumber
      serviceLabel = serviceCode
      pieces = fx.pieces
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Label purchase failed' }, { status: 502 })
  }

  if (pieces.length === 0) return NextResponse.json({ error: 'Carrier returned no labels' }, { status: 502 })

  const labelSetId = randomUUID()
  const created = await prisma.$transaction(async (tx) => {
    const rows = []
    for (let i = 0; i < pieces.length; i++) {
      rows.push(await tx.vendorReturnLabel.create({
        data: {
          vendorRmaId: rma.id, labelSetId, carrier, serviceCode, serviceLabel,
          shipmentId, trackingNumber: pieces[i].trackingNumber, pieceNumber: i + 1, pieceCount: pieces.length,
          labelData: pieces[i].labelData, labelFormat: pieces[i].labelFormat,
          shipmentCost: i === 0 ? shipmentCost : null, currency,
          upsCredentialId: carrier === 'ups' ? (upsCredentialId ?? null) : null,
          shipFrom: shipFrom as object, shipTo: shipToAddr as object,
        },
      }))
    }
    // Reflect the latest set on the RMA for its detail view / tracking status.
    await tx.vendorRMA.update({
      where: { id: rma.id },
      data: { carrier: carrier === 'ups' ? 'UPS' : 'FedEx', trackingNumber: shipmentId ?? pieces[0].trackingNumber },
    })
    return rows
  })

  return NextResponse.json({
    labelSetId, carrier, serviceLabel, shipmentCost, currency,
    pieces: created.map(r => ({ ...r, shipmentCost: r.shipmentCost != null ? Number(r.shipmentCost) : null })),
  }, { status: 201 })
}
