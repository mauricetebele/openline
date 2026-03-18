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

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: { warehouse: true },
  })
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

    // 2. Get ALL shipment IDs from the placement option
    step = 'list-placement-options'
    const placementOptions = await listPlacementOptions(shipment.accountId, shipment.inboundPlanId)
    const selectedOption = placementOptions.find(p => p.placementOptionId === body.placementOptionId)
    const allShipmentIds = selectedOption?.shipmentIds ?? []
    const amazonShipmentId = allShipmentIds[0] ?? null

    if (!amazonShipmentId) {
      throw new Error('No shipment ID returned from placement confirmation')
    }

    // 3. Generate & confirm delivery window for each shipment (required before transport options)
    for (const sid of allShipmentIds) {
      step = `generate-delivery-window(${sid})`
      try {
        const dwGenResp = await generateDeliveryWindowOptions(
          shipment.accountId,
          shipment.inboundPlanId,
          sid,
        )
        await pollOperationStatus(shipment.accountId, dwGenResp.operationId)

        step = `list-delivery-window(${sid})`
        const deliveryWindows = await listDeliveryWindowOptions(
          shipment.accountId,
          shipment.inboundPlanId,
          sid,
        )

        if (deliveryWindows.length > 0) {
          step = `confirm-delivery-window(${sid})`
          const selectedWindow = deliveryWindows[0]
          const dwConfirmResp = await confirmDeliveryWindowOptions(
            shipment.accountId,
            shipment.inboundPlanId,
            sid,
            selectedWindow.deliveryWindowOptionId,
          )
          await pollOperationStatus(shipment.accountId, dwConfirmResp.operationId)
        }
      } catch (dwErr) {
        const msg = dwErr instanceof Error ? dwErr.message : String(dwErr)
        // Delivery window may already be confirmed or not required — continue
        if (!msg.includes('already') && !msg.includes('cannot be processed')) {
          console.warn(`[confirm-placement] Delivery window step failed for ${sid} (continuing):`, msg)
        }
      }
    }

    // 4. Generate transportation options (must include ALL shipments in placement)
    let transportOptions: Awaited<ReturnType<typeof listTransportationOptions>> = []
    let transportWarning: string | null = null

    try {
      // Try listing first (may already exist)
      step = 'list-transportation-options'
      transportOptions = await listTransportationOptions(
        shipment.accountId,
        shipment.inboundPlanId,
        amazonShipmentId,
      )

      if (transportOptions.length === 0) {
        step = 'generate-transportation-options'
        // Ready to ship = 3 business days out (increases chance of partnered carrier options)
        const readyDate = new Date()
        readyDate.setDate(readyDate.getDate() + 5)

        const transportResp = await generateTransportationOptions(
          shipment.accountId,
          shipment.inboundPlanId,
          {
            placementOptionId: body.placementOptionId,
            shipmentIds: allShipmentIds,
            contactInformation: {
              name: shipment.warehouse?.name ?? 'Warehouse',
              phoneNumber: shipment.warehouse?.phone || '5551234567',
              email: user.email,
            },
            readyToShipDate: readyDate.toISOString(),
          },
        )
        await pollOperationStatus(shipment.accountId, transportResp.operationId)

        transportOptions = await listTransportationOptions(
          shipment.accountId,
          shipment.inboundPlanId,
          amazonShipmentId,
        )
      }
    } catch (transportErr) {
      const msg = transportErr instanceof Error ? transportErr.message : String(transportErr)
      console.error('[confirm-placement] Transport options failed:', msg)
      transportWarning = 'Could not fetch transportation options via API. Use Seller Central to select shipping. Error: ' + msg
    }

    // Extract placement fee
    const fee = selectedOption?.fees?.[0]?.amount?.amount ?? null

    // Update shipment — always advance status since placement IS confirmed
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: {
        status: 'PLACEMENT_CONFIRMED',
        placementOptionId: body.placementOptionId,
        shipmentId: amazonShipmentId,
        placementFee: fee,
        lastError: transportWarning,
        lastErrorAt: transportWarning ? new Date() : null,
      },
    })

    return NextResponse.json({
      success: true,
      shipmentId: amazonShipmentId,
      transportOptions,
      transportWarning,
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
