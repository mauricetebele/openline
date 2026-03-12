/**
 * GET /api/fba-shipments/[id]/labels
 *
 * Downloads shipment labels via the v0 API and returns the download URL.
 * Caches the URL on the shipment record.
 *
 * Status: TRANSPORT_CONFIRMED → LABELS_READY
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { getShipmentLabels } from '@/lib/amazon/fba-inbound'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({ where: { id: params.id } })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (!shipment.shipmentId) {
    return NextResponse.json({ error: 'No Amazon shipment ID on this shipment' }, { status: 400 })
  }

  // Return cached label if available
  if (shipment.labelData) {
    return NextResponse.json({ downloadUrl: shipment.labelData })
  }

  const allowed = new Set(['TRANSPORT_CONFIRMED', 'LABELS_READY'])
  if (!allowed.has(shipment.status)) {
    return NextResponse.json({ error: 'Shipment must be in TRANSPORT_CONFIRMED or LABELS_READY status' }, { status: 409 })
  }

  try {
    const downloadUrl = await getShipmentLabels(shipment.accountId, shipment.shipmentId)

    // Cache and advance status
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: {
        labelData: downloadUrl,
        status: 'LABELS_READY',
        lastError: null,
        lastErrorAt: null,
      },
    })

    return NextResponse.json({ downloadUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: { lastError: message, lastErrorAt: new Date() },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
