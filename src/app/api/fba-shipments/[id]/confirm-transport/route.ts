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
  if (!shipment.inboundPlanId || !shipment.shipmentId) {
    return NextResponse.json({ error: 'Missing plan or shipment ID' }, { status: 400 })
  }

  let body: { transportOptionId: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.transportOptionId) {
    return NextResponse.json({ error: 'transportOptionId is required' }, { status: 400 })
  }

  try {
    // 1. Confirm transport (skip if already confirmed from a prior attempt)
    try {
      const confirmResp = await confirmTransportationOptions(
        shipment.accountId,
        shipment.inboundPlanId,
        shipment.shipmentId,
        body.transportOptionId,
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

    // 2. Delivery window — may already be confirmed from confirm-placement step.
    //    Try to generate + confirm, but don't fail the whole flow if it errors.
    let deliveryWindowId: string | null = null
    try {
      const dwResp = await generateDeliveryWindowOptions(
        shipment.accountId,
        shipment.inboundPlanId,
        shipment.shipmentId,
      )
      await pollOperationStatus(shipment.accountId, dwResp.operationId)

      const windows = await listDeliveryWindowOptions(
        shipment.accountId,
        shipment.inboundPlanId,
        shipment.shipmentId,
      )

      if (windows.length > 0) {
        const firstWindow = windows[0]
        deliveryWindowId = firstWindow.deliveryWindowOptionId
        const dwConfirmResp = await confirmDeliveryWindowOptions(
          shipment.accountId,
          shipment.inboundPlanId,
          shipment.shipmentId,
          firstWindow.deliveryWindowOptionId,
        )
        await pollOperationStatus(shipment.accountId, dwConfirmResp.operationId)
      }
    } catch (dwErr) {
      // Delivery window may already be confirmed or expired — continue
      const msg = dwErr instanceof Error ? dwErr.message : String(dwErr)
      console.warn('[confirm-transport] Delivery window step skipped:', msg)
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
