/**
 * POST /api/fba-shipments/[id]/confirm-placement
 *
 * Confirms a placement option → extracts shipmentId → generates transport options.
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

  try {
    // 1. Confirm placement (skip if already confirmed)
    try {
      console.log('[confirm-placement] Confirming placement option:', {
        accountId: shipment.accountId,
        inboundPlanId: shipment.inboundPlanId,
        placementOptionId: body.placementOptionId,
      })
      const confirmResp = await confirmPlacementOption(
        shipment.accountId,
        shipment.inboundPlanId,
        body.placementOptionId,
      )
      console.log('[confirm-placement] Confirm response:', JSON.stringify(confirmResp))
      await pollOperationStatus(shipment.accountId, confirmResp.operationId)
    } catch (confirmErr) {
      const msg = confirmErr instanceof Error ? confirmErr.message : String(confirmErr)
      if (msg.includes('already confirmed') || msg.includes('ConfirmPlacementOption cannot be processed')) {
        console.log('[confirm-placement] Placement already confirmed, proceeding to next steps')
      } else {
        throw confirmErr
      }
    }

    // 2. Get the shipment ID from the placement option
    const placementOptions = await listPlacementOptions(shipment.accountId, shipment.inboundPlanId)
    const selectedOption = placementOptions.find(p => p.placementOptionId === body.placementOptionId)
    const amazonShipmentId = selectedOption?.shipmentIds?.[0] ?? null

    if (!amazonShipmentId) {
      throw new Error('No shipment ID returned from placement confirmation')
    }

    // 3. Generate transportation options
    const transportResp = await generateTransportationOptions(
      shipment.accountId,
      shipment.inboundPlanId,
      amazonShipmentId,
    )
    await pollOperationStatus(shipment.accountId, transportResp.operationId)

    // 4. List transportation options
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

    return NextResponse.json({ success: true, shipmentId: amazonShipmentId, transportOptions })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: { lastError: message, lastErrorAt: new Date() },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
