/**
 * GET /api/fba-shipments/[id]/placement-options
 *
 * Fetches placement options and shipment details for a shipment
 * that already has packing set. Used to reload options after page refresh.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { listPlacementOptions, listShipments, getShipment } from '@/lib/amazon/fba-inbound'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
  })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (!shipment.inboundPlanId) {
    return NextResponse.json({ error: 'No inbound plan' }, { status: 400 })
  }

  try {
    const placementOptions = await listPlacementOptions(shipment.accountId, shipment.inboundPlanId)

    // Collect all unique shipment IDs across all placement options
    const allShipmentIds = Array.from(new Set(placementOptions.flatMap(o => o.shipmentIds ?? [])))

    // Try list endpoint first, then fall back to individual fetches
    let shipments = await listShipments(shipment.accountId, shipment.inboundPlanId).catch(() => [])

    // If list didn't return shipments, try fetching individually
    if (shipments.length === 0 && allShipmentIds.length > 0) {
      const results = await Promise.allSettled(
        allShipmentIds.map(sid =>
          getShipment(shipment.accountId, shipment.inboundPlanId!, sid)
        )
      )
      shipments = results
        .filter((r): r is PromiseFulfilledResult<Record<string, unknown>> => r.status === 'fulfilled')
        .map(r => r.value)
    }

    return NextResponse.json({ placementOptions, shipments })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
