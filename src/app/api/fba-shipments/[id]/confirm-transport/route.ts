/**
 * POST /api/fba-shipments/[id]/confirm-transport
 *
 * Confirms transportation option → polls → generates delivery window →
 * polls → auto-confirms first delivery window.
 *
 * Body: { transportOptionId: string }
 * Status: PLACEMENT_CONFIRMED → TRANSPORT_CONFIRMED
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import {
  confirmTransportationOptions,
  pollOperationStatus,
  listPlacementOptions,
  listTransportationOptions,
  generateDeliveryWindowOptions,
  listDeliveryWindowOptions,
  confirmDeliveryWindowOptions,
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
  if (shipment.status !== 'PLACEMENT_CONFIRMED') {
    return NextResponse.json({ error: 'Shipment must be in PLACEMENT_CONFIRMED status' }, { status: 409 })
  }
  if (!shipment.inboundPlanId || !shipment.shipmentId || !shipment.placementOptionId) {
    return NextResponse.json({ error: 'Missing plan, shipment, or placement option ID' }, { status: 400 })
  }

  let body: { transportOptionId: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.transportOptionId) {
    return NextResponse.json({ error: 'transportOptionId is required' }, { status: 400 })
  }

  try {
    // 1. Get ALL shipment IDs from the placement option
    const placementOptions = await listPlacementOptions(shipment.accountId, shipment.inboundPlanId)
    const selectedOption = placementOptions.find(p => p.placementOptionId === shipment.placementOptionId)
    const allShipmentIds = selectedOption?.shipmentIds ?? [shipment.shipmentId]

    // 2. Build transport selections for ALL shipments
    //    The user selected a transport option for the primary shipment.
    //    For other shipments, auto-select a matching carrier/mode option.
    const primaryOption = body.transportOptionId
    const transportationSelections: Array<{ shipmentId: string; transportationOptionId: string }> = [
      { shipmentId: shipment.shipmentId, transportationOptionId: primaryOption },
    ]

    // Get the primary transport option details to match against
    const primaryTransportOptions = await listTransportationOptions(
      shipment.accountId,
      shipment.inboundPlanId,
      shipment.shipmentId,
    )
    const primaryDetails = primaryTransportOptions.find(o => o.transportationOptionId === primaryOption)

    for (const sid of allShipmentIds) {
      if (sid === shipment.shipmentId) continue // already added

      const opts = await listTransportationOptions(
        shipment.accountId,
        shipment.inboundPlanId,
        sid,
      )

      // Try to match same carrier + shipping solution, then same shipping solution, then first available
      let match = primaryDetails
        ? opts.find(o =>
            o.shippingSolution === primaryDetails.shippingSolution &&
            o.carrier?.name === primaryDetails.carrier?.name &&
            o.shippingMode === primaryDetails.shippingMode)
        : undefined
      if (!match && primaryDetails) {
        match = opts.find(o => o.shippingSolution === primaryDetails.shippingSolution)
      }
      if (!match && opts.length > 0) {
        match = opts[0]
      }

      if (match) {
        transportationSelections.push({
          shipmentId: sid,
          transportationOptionId: match.transportationOptionId,
        })
      }
    }

    // 3. Confirm transport (skip if already confirmed from a prior attempt)
    try {
      const confirmResp = await confirmTransportationOptions(
        shipment.accountId,
        shipment.inboundPlanId,
        transportationSelections,
      )
      await pollOperationStatus(shipment.accountId, confirmResp.operationId)
    } catch (confirmErr) {
      const msg = confirmErr instanceof Error ? confirmErr.message : String(confirmErr)
      if (msg.includes('already') || msg.includes('ConfirmTransportationOptions cannot be processed')) {
        // Already confirmed — continue to update status
      } else {
        throw confirmErr
      }
    }

    // 4. Delivery window — may already be confirmed from confirm-placement step.
    //    Try to generate + confirm for all shipments, but don't fail the whole flow if it errors.
    let deliveryWindowId: string | null = null
    for (const sid of allShipmentIds) {
      try {
        const dwResp = await generateDeliveryWindowOptions(
          shipment.accountId,
          shipment.inboundPlanId,
          sid,
        )
        await pollOperationStatus(shipment.accountId, dwResp.operationId)

        const windows = await listDeliveryWindowOptions(
          shipment.accountId,
          shipment.inboundPlanId,
          sid,
        )

        if (windows.length > 0) {
          const firstWindow = windows[0]
          if (sid === shipment.shipmentId) {
            deliveryWindowId = firstWindow.deliveryWindowOptionId
          }
          const dwConfirmResp = await confirmDeliveryWindowOptions(
            shipment.accountId,
            shipment.inboundPlanId,
            sid,
            firstWindow.deliveryWindowOptionId,
          )
          await pollOperationStatus(shipment.accountId, dwConfirmResp.operationId)
        }
      } catch (dwErr) {
        const msg = dwErr instanceof Error ? dwErr.message : String(dwErr)
        if (!msg.includes('already') && !msg.includes('cannot be processed')) {
          console.warn(`[confirm-transport] Delivery window step skipped for ${sid}:`, msg)
        }
      }
    }

    // Update shipment
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: {
        status: 'TRANSPORT_CONFIRMED',
        transportOptionId: body.transportOptionId,
        ...(deliveryWindowId ? { deliveryWindowOptionId: deliveryWindowId } : {}),
        lastError: null,
        lastErrorAt: null,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: { lastError: message, lastErrorAt: new Date() },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
