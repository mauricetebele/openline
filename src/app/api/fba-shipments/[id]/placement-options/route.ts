/**
 * GET /api/fba-shipments/[id]/placement-options
 *
 * Fetches placement options and shipment details for a shipment
 * that already has packing set. Used to reload options after page refresh.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { listPlacementOptions, listShipments } from '@/lib/amazon/fba-inbound'

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
    const [placementOptions, shipments] = await Promise.all([
      listPlacementOptions(shipment.accountId, shipment.inboundPlanId),
      listShipments(shipment.accountId, shipment.inboundPlanId).catch(() => []),
    ])

    return NextResponse.json({ placementOptions, shipments })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
