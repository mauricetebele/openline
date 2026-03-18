/**
 * POST /api/fba-shipments/[id]/confirm-placement
 *
 * Confirms a placement option → confirms delivery window → generates transport options.
 *
 * Body: { placementOptionId: string }
 * Status: PACKING_SET → PLACEMENT_CONFIRMED
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import {
  confirmPlacementOption,
  pollOperationStatus,
  generateDeliveryWindowOptions,
  listDeliveryWindowOptions,
  confirmDeliveryWindowOptions,
  generateTransportationOptions,
  listTransportationOptions,
  listPlacementOptions,
} from '@/lib/amazon/fba-inbound'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({ where: { id: params.id } })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (shipment.status !== 'PACKING_SET') {
    return NextResponse.json({ error: 'Shipment must be in PACKING_SET status' }, { status: 409 })
  }
  if (!shipment.inboundPlanId) {
    return NextResponse.json({ error: 'Missing inbound plan ID' }, { status: 400 })
  }

  let body: { placementOptionId: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.placementOptionId) {
    return NextResponse.json({ error: 'placementOptionId is required' }, { status: 400 })
  }

  let step = 'confirm-placement'
  try {
    // 1. Confirm placement (skip if already confirmed)
    try {
      const confirmResp = await confirmPlacementOption(
        shipment.accountId,
        shipment.inboundPlanId,
        body.placementOptionId,
      )
      await pollOperationStatus(shipment.accountId, confirmResp.operationId)
    } catch (confirmErr) {
      const msg = confirmErr instanceof Error ? confirmErr.message : String(confirmErr)
      if (msg.includes('already confirmed') || msg.includes('ConfirmPlacementOption cannot be processed')) {
        // Already confirmed from a prior attempt — continue
      } else {
        throw confirmErr
      }
    }

    // 2. Get the shipment ID from the placement option
    step = 'list-placement-options'
    const placementOptions = await listPlacementOptions(shipment.accountId, shipment.inboundPlanId)
    const selectedOption = placementOptions.find(p => p.placementOptionId === body.placementOptionId)
    const amazonShipmentId = selectedOption?.shipmentIds?.[0] ?? null

    if (!amazonShipmentId) {
      throw new Error('No shipment ID returned from placement confirmation')
    }

    // 3. Generate & confirm delivery window (required before transport options)
    step = 'generate-delivery-window'
    const dwGenResp = await generateDeliveryWindowOptions(
      shipment.accountId,
      shipment.inboundPlanId,
      amazonShipmentId,
    )
    await pollOperationStatus(shipment.accountId, dwGenResp.operationId)

    step = 'list-delivery-window'
    const deliveryWindows = await listDeliveryWindowOptions(
      shipment.accountId,
      shipment.inboundPlanId,
      amazonShipmentId,
    )

    if (deliveryWindows.length === 0) {
      throw new Error('No delivery window options returned from Amazon')
    }

    // Auto-select first available delivery window
    step = 'confirm-delivery-window'
    const selectedWindow = deliveryWindows[0]
    const dwConfirmResp = await confirmDeliveryWindowOptions(
      shipment.accountId,
      shipment.inboundPlanId,
      amazonShipmentId,
      selectedWindow.deliveryWindowOptionId,
    )
    await pollOperationStatus(shipment.accountId, dwConfirmResp.operationId)

    // 4. Generate transportation options
    step = 'generate-transportation-options'
    const transportResp = await generateTransportationOptions(
      shipment.accountId,
      shipment.inboundPlanId,
      amazonShipmentId,
      body.placementOptionId,
    )
    step = 'poll-generate-transport'
    await pollOperationStatus(shipment.accountId, transportResp.operationId)

    // 5. List transportation options
    step = 'list-transportation-options'
    const transportOptions = await listTransportationOptions(
      shipment.accountId,
      shipment.inboundPlanId,
      amazonShipmentId,
    )

    // Extract placement fee
    const fee = selectedOption?.fees?.[0]?.amount?.amount ?? null

    // Update shipment
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: {
        status: 'PLACEMENT_CONFIRMED',
        placementOptionId: body.placementOptionId,
        shipmentId: amazonShipmentId,
        placementFee: fee,
        lastError: null,
        lastErrorAt: null,
      },
    })

    return NextResponse.json({
      success: true,
      shipmentId: amazonShipmentId,
      transportOptions,
      deliveryWindow: {
        start: selectedWindow.startDate,
        end: selectedWindow.endDate,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const fullMessage = `[${step}] ${message}`
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: { lastError: fullMessage, lastErrorAt: new Date() },
    })
    return NextResponse.json({ error: fullMessage }, { status: 500 })
  }
}
