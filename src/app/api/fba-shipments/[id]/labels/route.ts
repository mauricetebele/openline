/**
 * GET /api/fba-shipments/[id]/labels
 *
 * Downloads shipment labels for ALL shipments in the placement option.
 * Uses the v0 API with shipmentConfirmationId and box IDs from v2024-03-20.
 *
 * Status: TRANSPORT_CONFIRMED → LABELS_READY
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import {
  getShipment,
  listShipmentBoxes,
  getShipmentLabels,
  listPlacementOptions,
} from '@/lib/amazon/fba-inbound'

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

  // Return cached labels if available
  if (shipment.labelData) {
    try {
      const parsed = JSON.parse(shipment.labelData)
      if (Array.isArray(parsed)) {
        // New format: array of {shipmentId, confirmationId, boxCount, url}
        if (parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0].url) {
          const urls = parsed.map((sl: { url: string }) => sl.url)
          return NextResponse.json({ downloadUrls: urls, downloadUrl: urls[0], shipmentLabels: parsed, totalShipments: parsed.length, labelsFound: parsed.length })
        }
        // Legacy format: array of URL strings
        return NextResponse.json({ downloadUrls: parsed, downloadUrl: parsed[0] })
      }
    } catch {
      // Legacy single URL
      return NextResponse.json({ downloadUrl: shipment.labelData })
    }
  }

  const allowed = new Set(['TRANSPORT_CONFIRMED', 'LABELS_READY'])
  if (!allowed.has(shipment.status)) {
    return NextResponse.json({ error: 'Shipment must be in TRANSPORT_CONFIRMED or LABELS_READY status' }, { status: 409 })
  }

  try {
    // Get ALL shipment IDs from the placement option
    let allShipmentIds = [shipment.shipmentId]
    if (shipment.placementOptionId) {
      const placementOptions = await listPlacementOptions(shipment.accountId, shipment.inboundPlanId)
      const selectedOption = placementOptions.find(p => p.placementOptionId === shipment.placementOptionId)
      if (selectedOption?.shipmentIds?.length) {
        allShipmentIds = selectedOption.shipmentIds
      }
    }

    const downloadUrls: string[] = []
    const shipmentLabels: Array<{ shipmentId: string; confirmationId: string; boxCount: number; url: string }> = []
    const errors: string[] = []

    for (const sid of allShipmentIds) {
      try {
        // 1. Get the shipmentConfirmationId from v2024-03-20
        const shipmentDetails = await getShipment(
          shipment.accountId,
          shipment.inboundPlanId,
          sid,
        )

        const confirmationId = shipmentDetails.shipmentConfirmationId
          ?? shipmentDetails.amazonReferenceId
          ?? shipmentDetails.shipmentId

        if (!confirmationId) {
          errors.push(`${sid}: no confirmationId`)
          continue
        }

        // 2. Get box IDs
        const boxes = await listShipmentBoxes(
          shipment.accountId,
          shipment.inboundPlanId,
          sid,
        )

        const boxIds = boxes.map(b => b.boxId ?? b.packageId).filter(Boolean) as string[]

        if (boxIds.length === 0) {
          errors.push(`${sid} (${confirmationId}): no boxes`)
          continue
        }

        // 3. Fetch labels — try partnered format first, fallback to non-partnered
        let downloadUrl: string
        try {
          downloadUrl = await getShipmentLabels(shipment.accountId, confirmationId, boxIds, true)
        } catch {
          downloadUrl = await getShipmentLabels(shipment.accountId, confirmationId, boxIds, false)
        }

        downloadUrls.push(downloadUrl)
        shipmentLabels.push({ shipmentId: sid, confirmationId, boxCount: boxIds.length, url: downloadUrl })

        // Try to extract per-box tracking numbers
        for (let i = 0; i < boxes.length; i++) {
          const box = boxes[i] as Record<string, unknown>
          const tracking = (box.trackingId ?? box.trackingNumber ?? null) as string | null
          if (tracking) {
            await prisma.fbaShipmentBox.updateMany({
              where: { shipmentId: params.id, boxNumber: i + 1, trackingNumber: null },
              data: { trackingNumber: tracking },
            })
          }
        }
      } catch (shipErr) {
        const msg = shipErr instanceof Error ? shipErr.message : String(shipErr)
        errors.push(`${sid}: ${msg}`)
      }
    }

    if (downloadUrls.length === 0) {
      throw new Error(
        `Could not fetch labels for any of ${allShipmentIds.length} shipments. Errors: ${errors.join('; ')}`,
      )
    }

    // Persist all label URLs and update status
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: {
        labelData: JSON.stringify(shipmentLabels),
        status: 'LABELS_READY',
        lastError: errors.length > 0
          ? `Labels fetched for ${downloadUrls.length}/${allShipmentIds.length} shipments. Skipped: ${errors.join('; ')}`
          : null,
        lastErrorAt: errors.length > 0 ? new Date() : null,
      },
    })

    return NextResponse.json({
      downloadUrls,
      downloadUrl: downloadUrls[0],
      shipmentLabels,
      totalShipments: allShipmentIds.length,
      labelsFound: downloadUrls.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: { lastError: message, lastErrorAt: new Date() },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
