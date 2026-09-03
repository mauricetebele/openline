/**
 * GET  /api/wholesale/orders/[id]/shipping-label  — labels already made for this order
 * POST /api/wholesale/orders/[id]/shipping-label  — generate a UPS or FedEx label
 *
 * Ships FROM our warehouse (RETURN_ADDRESS) TO the customer address in the
 * request. The request's shipFrom* fields carry the DESTINATION (customer)
 * address — the same naming the shared UPS lib / /api/outbound-label use.
 * Rating is done client-side via /api/outbound-label/rate (UPS) or
 * /api/fedex/rate-shop (FedEx); this endpoint only buys + persists the label.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { generateUpsMultiPieceLabels, UPS_SERVICES, RETURN_ADDRESS, type MultiPieceAddress, type MultiPiecePackage } from '@/lib/ups-tracking'
import { loadFedExCredentials, createMultiPieceShipment, getMultiPieceRate, type FedExMultiPieceParams } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

interface PackageInput {
  weightValue: number
  weightUnit: 'LBS' | 'OZS'
  length?: number
  width?: number
  height?: number
  dimUnit?: 'IN' | 'CM'
}

const FEDEX_SERVICE_NAMES: Record<string, string> = {
  FEDEX_GROUND: 'FedEx Ground',
  FEDEX_EXPRESS_SAVER: 'FedEx Express Saver',
  FEDEX_2_DAY: 'FedEx 2Day',
  FEDEX_2_DAY_AM: 'FedEx 2Day AM',
  STANDARD_OVERNIGHT: 'FedEx Standard Overnight',
  PRIORITY_OVERNIGHT: 'FedEx Priority Overnight',
  FIRST_OVERNIGHT: 'FedEx First Overnight',
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const labels = await prisma.returnLabel.findMany({
    where: { salesOrderId: params.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, trackingNumber: true, shipmentId: true, serviceLabel: true, serviceCode: true,
      weightValue: true, weightUnit: true, shipmentCost: true, currency: true,
      voided: true, createdAt: true,
    },
  })
  return NextResponse.json({ labels })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    carrier?: 'UPS' | 'FEDEX'
    upsCredentialId?: string
    shipFromName?: string; shipFromCompany?: string; shipFromAddress1?: string; shipFromAddress2?: string
    shipFromCity?: string; shipFromState?: string; shipFromPostal?: string; shipFromCountry?: string
    shipToPhone?: string
    serviceCode?: string
    confirmation?: 'none' | 'delivery' | 'signature' | 'adult_signature'
    packages?: PackageInput[]
    referenceNumber?: string
  }
  const carrier = body.carrier === 'FEDEX' ? 'FEDEX' : 'UPS'
  const packages = Array.isArray(body.packages) ? body.packages : []

  // NOTE: shipFrom* fields carry the DESTINATION (customer) address for an
  // outbound label — the shipper is our warehouse (RETURN_ADDRESS).
  const toName = body.shipFromName?.trim() || body.shipFromCompany?.trim() || ''
  if (!toName || !body.shipFromAddress1?.trim() ||
      !body.shipFromCity?.trim() || !body.shipFromState?.trim() || !body.shipFromPostal?.trim()) {
    return NextResponse.json({ error: 'Ship-to name/company and address fields are required' }, { status: 400 })
  }
  if (!body.serviceCode) return NextResponse.json({ error: 'Service code is required' }, { status: 400 })
  if (packages.length === 0) return NextResponse.json({ error: 'Add at least one box' }, { status: 400 })
  for (let i = 0; i < packages.length; i++) {
    if (!(Number(packages[i].weightValue) > 0)) return NextResponse.json({ error: `Box ${i + 1}: weight must be greater than 0` }, { status: 400 })
  }

  const order = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    select: { id: true, orderNumber: true, fulfillmentStatus: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const serviceCode = body.serviceCode
  const reference = body.referenceNumber || order.orderNumber

  // Ship-from = our warehouse; ship-to = the customer address in the request.
  const settings = await prisma.storeSettings.findUnique({ where: { id: 'singleton' }, select: { phone: true } }).catch(() => null)
  const fromPhone = settings?.phone?.trim() || '7325555555'

  const shipFrom: MultiPieceAddress = {
    name: RETURN_ADDRESS.name, company: RETURN_ADDRESS.name,
    address1: RETURN_ADDRESS.line1, address2: RETURN_ADDRESS.line2,
    city: RETURN_ADDRESS.city, state: RETURN_ADDRESS.state, postal: RETURN_ADDRESS.postal, country: RETURN_ADDRESS.country,
    phone: fromPhone,
  }
  const shipTo: MultiPieceAddress = {
    name: toName,
    company: body.shipFromCompany?.trim() || undefined,
    address1: body.shipFromAddress1!.trim(), address2: body.shipFromAddress2?.trim() || undefined,
    city: body.shipFromCity!.trim(), state: body.shipFromState!.trim(), postal: body.shipFromPostal!.trim(),
    country: body.shipFromCountry?.trim() || 'US', phone: body.shipToPhone?.trim() || undefined,
  }

  let shipmentId = ''
  let cost: number | null = null
  let serviceLabel: string
  let pieces: { trackingNumber: string; labelData: string; labelFormat: string }[] = []

  try {
    if (carrier === 'FEDEX') {
      const creds = await loadFedExCredentials()
      if (!creds) return NextResponse.json({ error: 'FedEx credentials not configured — add them in Settings → FedEx.' }, { status: 400 })

      const confirmationToSignature: Record<string, 'DIRECT' | 'ADULT' | 'INDIRECT'> = {
        signature: 'DIRECT', adult_signature: 'ADULT', delivery: 'INDIRECT',
      }
      const sig = body.confirmation ? confirmationToSignature[body.confirmation] : undefined

      const fedexParams: FedExMultiPieceParams = {
        shipFrom: {
          streetLines: [RETURN_ADDRESS.line1, RETURN_ADDRESS.line2].filter(Boolean) as string[],
          city: RETURN_ADDRESS.city, stateOrProvinceCode: RETURN_ADDRESS.state, postalCode: RETURN_ADDRESS.postal, countryCode: RETURN_ADDRESS.country,
          personName: RETURN_ADDRESS.name, phone: fromPhone.replace(/[^0-9]/g, '') || '0000000000',
        },
        shipTo: {
          streetLines: [shipTo.address1, shipTo.address2].filter(Boolean) as string[],
          city: shipTo.city, stateOrProvinceCode: shipTo.state.slice(0, 2), postalCode: shipTo.postal, countryCode: shipTo.country,
          personName: shipTo.name, phone: (shipTo.phone ?? '').replace(/[^0-9]/g, '') || '0000000000',
        },
        packages: packages.map(p => ({
          weight: { value: p.weightUnit === 'OZS' ? Number(p.weightValue) / 16 : Number(p.weightValue), units: 'LB' },
          ...(p.length && p.width && p.height ? { dimensions: { length: Number(p.length), width: Number(p.width), height: Number(p.height), units: p.dimUnit === 'CM' ? 'CM' : 'IN' } } : {}),
        })),
        serviceType: serviceCode,
        ...(sig ? { signatureType: sig } : {}),
        reference,
      }
      const fx = await createMultiPieceShipment(creds, fedexParams)
      shipmentId = fx.masterTrackingNumber
      serviceLabel = FEDEX_SERVICE_NAMES[serviceCode] ?? serviceCode
      pieces = fx.pieces
      // FedEx's ship response omits cost — fetch the account rate for the total.
      try { cost = (await getMultiPieceRate(creds, fedexParams)).total } catch (e) { console.error('[WholesaleLabel] FedEx rate failed:', e) }
    } else {
      const upsPackages: MultiPiecePackage[] = packages.map(p => ({
        weightValue: Number(p.weightValue), weightUnit: p.weightUnit === 'OZS' ? 'OZS' : 'LBS',
        length: p.length ? Number(p.length) : undefined, width: p.width ? Number(p.width) : undefined,
        height: p.height ? Number(p.height) : undefined, dimUnit: p.dimUnit === 'CM' ? 'CM' : 'IN',
      }))
      const result = await generateUpsMultiPieceLabels({
        shipFrom, shipTo, serviceCode, packages: upsPackages, confirmation: body.confirmation,
        referenceNumber: reference, description: `Wholesale Order ${order.orderNumber}`,
      }, body.upsCredentialId)
      shipmentId = result.shipmentId
      cost = result.shipmentCost != null ? Number(result.shipmentCost) : null
      serviceLabel = UPS_SERVICES.find(s => s.code === serviceCode)?.label ?? serviceCode
      pieces = result.pieces.map(p => ({ trackingNumber: p.trackingNumber, labelData: p.labelBase64, labelFormat: p.labelFormat }))
    }
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Label generation failed' }, { status: 500 })
  }

  if (pieces.length === 0) return NextResponse.json({ error: 'Carrier returned no labels' }, { status: 502 })

  const labelSetId = randomUUID()
  const created = await prisma.$transaction(async (tx) => {
    const rows = []
    for (let i = 0; i < pieces.length; i++) {
      const p = packages[i] ?? packages[packages.length - 1]
      const wLbs = p.weightUnit === 'OZS' ? Math.round((Number(p.weightValue) / 16) * 100) / 100 : Number(p.weightValue)
      rows.push(await tx.returnLabel.create({
        data: {
          salesOrderId:     order.id,
          shipFromName:     shipTo.name,
          shipFromAddress1: shipTo.address1,
          shipFromCity:     shipTo.city,
          shipFromState:    shipTo.state,
          shipFromPostal:   shipTo.postal,
          shipFromCountry:  shipTo.country,
          serviceCode,
          serviceLabel,
          weightValue:      wLbs,
          weightUnit:       'LBS',
          trackingNumber:   pieces[i].trackingNumber,
          shipmentId:       shipmentId || pieces[i].trackingNumber,
          labelData:        pieces[i].labelData,
          shipmentCost:     i === 0 ? cost : null,
          currency:         'USD',
          labelType:        'WHOLESALE',
          upsCredentialId:  carrier === 'UPS' ? (body.upsCredentialId ?? null) : null,
        },
      }))
    }
    return rows
  })

  // Record the shipment's master tracking on the order (does NOT mark it shipped).
  if (order.fulfillmentStatus !== 'SHIPPED') {
    await prisma.salesOrder.update({
      where: { id: order.id },
      data: {
        shipCarrier: carrier === 'FEDEX' ? 'FedEx' : 'UPS',
        shipTracking: shipmentId || pieces[0].trackingNumber,
        ...(cost != null ? { actualShippingCost: cost } : {}),
      },
    }).catch(err => console.error('[WholesaleLabel] order writeback failed:', err))
  }

  return NextResponse.json({
    carrier: carrier === 'FEDEX' ? 'FedEx' : 'UPS',
    labelSetId,
    masterTracking: shipmentId || pieces[0].trackingNumber,
    shipmentCost: cost != null ? String(cost) : undefined,
    currency: 'USD',
    pieces: created.map((r, i) => ({ labelId: r.id, trackingNumber: r.trackingNumber, labelBase64: pieces[i].labelData, labelFormat: pieces[i].labelFormat })),
  })
}
