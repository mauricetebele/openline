/**
 * GET /api/fba-shipments/[id]/labels
 *
 * Downloads shipment labels via the v0 API using the shipmentConfirmationId
 * and box IDs from the v2024-03-20 API.
 *
 * Status: TRANSPORT_CONFIRMED → LABELS_READY
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { getShipment, listShipmentBoxes, getShipmentLabels } from '@/lib/amazon/fba-inbound'

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
  if (!shipment.shipmentId || !shipment.inboundPlanId) {
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
    // 1. Get the shipmentConfirmationId (FBA1234ABCD format) from v2024-03-20
    const shipmentDetails = await getShipment(
      shipment.accountId,
      shipment.inboundPlanId,
      shipment.shipmentId,
    )

    const confirmationId = shipmentDetails.shipmentConfirmationId
      ?? shipmentDetails.amazonReferenceId
      ?? shipmentDetails.shipmentId

    if (!confirmationId) {
      throw new Error('No shipmentConfirmationId found in shipment details')
    }

    // 2. Get box IDs from v2024-03-20 (required for UNIQUE label type)
    const boxes = await listShipmentBoxes(
      shipment.accountId,
      shipment.inboundPlanId,
      shipment.shipmentId,
    )

    const boxIds = boxes.map(b => b.boxId ?? b.packageId).filter(Boolean) as string[]

    if (boxIds.length === 0) {
      throw new Error('No box IDs found for this shipment')
    }

    // 3. Fetch labels from v0 API with box IDs
    //    Try partnered format first (PackageLabel_Letter_2 = FBA + UPS on same page).
    //    Fall back to non-partnered (PackageLabel_Letter_6 = FBA only) if it fails.
    let downloadUrl: string
    try {
      downloadUrl = await getShipmentLabels(shipment.accountId, confirmationId, boxIds, true)
    } catch {
      downloadUrl = await getShipmentLabels(shipment.accountId, confirmationId, boxIds, false)
    }

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
