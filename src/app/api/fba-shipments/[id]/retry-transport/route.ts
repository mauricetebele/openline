/**
 * GET /api/fba-shipments/[id]/retry-transport
 *
 * Retries fetching transportation options for a PLACEMENT_CONFIRMED shipment.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import {
  generateTransportationOptions,
  listTransportationOptions,
  pollOperationStatus,
} from '@/lib/amazon/fba-inbound'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({ where: { id: params.id } })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (!shipment.inboundPlanId || !shipment.shipmentId) {
    return NextResponse.json({ error: 'Shipment missing plan or shipment ID' }, { status: 400 })
  }

  try {
    // Try listing first
    let transportOptions = await listTransportationOptions(
      shipment.accountId,
      shipment.inboundPlanId,
      shipment.shipmentId,
    )

    if (transportOptions.length === 0 && shipment.placementOptionId) {
      // Try generating
      const resp = await generateTransportationOptions(
        shipment.accountId,
        shipment.inboundPlanId,
        shipment.shipmentId,
        shipment.placementOptionId,
      )
      await pollOperationStatus(shipment.accountId, resp.operationId)

      transportOptions = await listTransportationOptions(
        shipment.accountId,
        shipment.inboundPlanId,
        shipment.shipmentId,
      )
    }

    return NextResponse.json({ transportOptions })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, transportOptions: [] }, { status: 200 })
  }
}
