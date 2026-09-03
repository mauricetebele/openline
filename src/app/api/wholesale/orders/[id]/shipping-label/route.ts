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
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { generateOutboundLabel, UPS_SERVICES, RETURN_ADDRESS, ReturnLabelRequest } from '@/lib/ups-tracking'
import { loadFedExCredentials, createShipment, type FedExShipmentParams, type FedExSignatureType } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

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
      id: true, trackingNumber: true, serviceLabel: true, serviceCode: true,
      weightValue: true, weightUnit: true, shipmentCost: true, currency: true,
      voided: true, createdAt: true,
    },
  })
  return NextResponse.json({ labels })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as ReturnLabelRequest & {
    carrier?: 'UPS' | 'FEDEX'
    upsCredentialId?: string
    shipToPhone?: string
  }
  const carrier = body.carrier === 'FEDEX' ? 'FEDEX' : 'UPS'

  if (!body.shipFromName?.trim() || !body.shipFromAddress1?.trim() ||
      !body.shipFromCity?.trim() || !body.shipFromState?.trim() || !body.shipFromPostal?.trim()) {
    return NextResponse.json({ error: 'Ship-to address fields are required' }, { status: 400 })
  }
  if (!body.serviceCode) return NextResponse.json({ error: 'Service code is required' }, { status: 400 })
  if (!body.weightValue || body.weightValue <= 0) return NextResponse.json({ error: 'Weight is required' }, { status: 400 })

  const order = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    select: { id: true, orderNumber: true, fulfillmentStatus: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  try {
    let trackingNumber: string
    let shipmentId: string
    let labelBase64: string
    let labelFormat: string
    let cost: number | null = null
    let serviceLabel: string
    let weightForDb = body.weightValue
    let weightUnitForDb: string = body.weightUnit

    if (carrier === 'FEDEX') {
      const creds = await loadFedExCredentials()
      if (!creds) return NextResponse.json({ error: 'FedEx credentials not configured — add them in Settings → FedEx.' }, { status: 400 })

      // FedEx needs a shipper phone; pull the store phone, else a placeholder.
      const settings = await prisma.storeSettings.findUnique({ where: { id: 'singleton' }, select: { phone: true } }).catch(() => null)
      const fromPhone = settings?.phone?.trim() || '7325555555'

      // FedEx accepts LB/KG only — convert ounces to pounds.
      let wVal = body.weightValue
      if (body.weightUnit === 'OZS') { wVal = Math.round((wVal / 16) * 100) / 100; weightUnitForDb = 'LBS' }
      weightForDb = wVal

      const confirmationToSignature: Record<string, FedExSignatureType> = {
        signature: 'DIRECT', adult_signature: 'ADULT', delivery: 'INDIRECT',
      }
      const sig = body.confirmation ? confirmationToSignature[body.confirmation] : undefined

      const fromStreets = [RETURN_ADDRESS.line1, RETURN_ADDRESS.line2].filter(Boolean)
      const toStreets = [body.shipFromAddress1.trim(), body.shipFromAddress2?.trim()].filter(Boolean) as string[]

      const shipParams: FedExShipmentParams = {
        shipFrom: {
          streetLines: fromStreets, city: RETURN_ADDRESS.city, stateOrProvinceCode: RETURN_ADDRESS.state,
          postalCode: RETURN_ADDRESS.postal, countryCode: RETURN_ADDRESS.country,
          personName: RETURN_ADDRESS.name, phone: fromPhone,
        },
        shipTo: {
          streetLines: toStreets, city: body.shipFromCity.trim(), stateOrProvinceCode: body.shipFromState.trim().slice(0, 2),
          postalCode: body.shipFromPostal.trim(), countryCode: body.shipFromCountry?.trim() || 'US', residential: false,
          personName: body.shipFromName.trim(), phone: body.shipToPhone?.trim() || fromPhone,
        },
        weight: { value: wVal, units: 'LB' },
        // FedEx requires dimensions for YOUR_PACKAGING — default a small box if none given.
        dimensions: (body.length && body.width && body.height)
          ? { length: body.length, width: body.width, height: body.height, units: 'IN' }
          : { length: 12, width: 9, height: 3, units: 'IN' },
        serviceType: body.serviceCode,
        ...(sig ? { signatureType: sig } : {}),
      }

      const result = await createShipment(creds, shipParams)
      trackingNumber = result.trackingNumber
      shipmentId = result.trackingNumber // FedEx has no separate shipment id; void by tracking
      labelBase64 = result.labelData
      labelFormat = result.labelFormat
      serviceLabel = FEDEX_SERVICE_NAMES[body.serviceCode] ?? body.serviceCode
    } else {
      const result = await generateOutboundLabel(
        { ...body, referenceNumber: body.referenceNumber || order.orderNumber },
        body.upsCredentialId,
      )
      trackingNumber = result.trackingNumber
      shipmentId = result.shipmentId
      labelBase64 = result.labelBase64
      labelFormat = result.labelFormat
      cost = result.shipmentCost ? parseFloat(result.shipmentCost) : null
      serviceLabel = UPS_SERVICES.find(s => s.code === body.serviceCode)?.label ?? body.serviceCode
    }

    const saved = await prisma.returnLabel.create({
      data: {
        salesOrderId:     order.id,
        shipFromName:     body.shipFromName,
        shipFromAddress1: body.shipFromAddress1,
        shipFromCity:     body.shipFromCity,
        shipFromState:    body.shipFromState,
        shipFromPostal:   body.shipFromPostal,
        shipFromCountry:  body.shipFromCountry || 'US',
        serviceCode:      body.serviceCode,
        serviceLabel,
        weightValue:      weightForDb,
        weightUnit:       weightUnitForDb,
        trackingNumber,
        shipmentId,
        labelData:        labelBase64,
        shipmentCost:     cost,
        currency:         'USD',
        labelType:        'WHOLESALE',
        upsCredentialId:  carrier === 'UPS' ? (body.upsCredentialId ?? null) : null,
      },
    })

    // Record the label's tracking on the order (does NOT mark it shipped).
    if (order.fulfillmentStatus !== 'SHIPPED') {
      await prisma.salesOrder.update({
        where: { id: order.id },
        data: {
          shipCarrier: carrier === 'FEDEX' ? 'FedEx' : 'UPS',
          shipTracking: trackingNumber,
          ...(cost != null ? { actualShippingCost: cost } : {}),
        },
      }).catch(err => console.error('[WholesaleLabel] order writeback failed:', err))
    }

    return NextResponse.json({ carrier: carrier === 'FEDEX' ? 'FedEx' : 'UPS', trackingNumber, labelBase64, labelFormat, shipmentCost: cost != null ? String(cost) : undefined, currency: 'USD', labelId: saved.id })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Label generation failed' },
      { status: 500 },
    )
  }
}
