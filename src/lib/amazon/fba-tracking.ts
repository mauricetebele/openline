/**
 * Sync per-box tracking numbers for an FBA inbound shipment from Amazon.
 *
 * Re-pulls the boxes for each Amazon shipment in the placement option
 * (listShipmentBoxes → box.trackingId) and stores each tracking number on the
 * matching FbaShipmentBox (mapped by order → boxNumber). This is what feeds the
 * Live Shipping Manifest, which renders one row per box tracking number.
 *
 * Partnered small-parcel tracking is assigned by the carrier and often only
 * becomes available a little after labels are generated, so this can be run
 * on-demand (button) and is fired automatically when a shipment is marked shipped.
 */
import { prisma } from '@/lib/prisma'
import { listShipmentBoxes, listPlacementOptions } from '@/lib/amazon/fba-inbound'

export type SyncTrackingResult =
  | { updated: number; total: number; tracked: number }
  | { error: string; status?: number }

export async function syncFbaTracking(fbaShipmentId: string): Promise<SyncTrackingResult> {
  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: fbaShipmentId },
    include: {
      boxes: { select: { id: true, boxNumber: true, trackingNumber: true }, orderBy: { boxNumber: 'asc' } },
    },
  })
  if (!shipment) return { error: 'Shipment not found', status: 404 }
  if (!shipment.shipmentId || !shipment.inboundPlanId) {
    return { error: 'No Amazon shipment ID on this shipment yet', status: 400 }
  }
  if (shipment.boxes.length === 0) {
    return { error: 'This shipment has no boxes to attach tracking to', status: 400 }
  }

  // A placement option can span several Amazon shipments; collect them all.
  let allShipmentIds = [shipment.shipmentId]
  try {
    if (shipment.placementOptionId) {
      const placementOptions = await listPlacementOptions(shipment.accountId, shipment.inboundPlanId)
      const selected = placementOptions.find(p => p.placementOptionId === shipment.placementOptionId)
      if (selected?.shipmentIds?.length) allShipmentIds = selected.shipmentIds
    }
  } catch { /* fall back to the single shipmentId */ }

  // Pull tracking IDs in box order across all Amazon shipments.
  const trackingIds: string[] = []
  for (const sid of allShipmentIds) {
    try {
      const boxes = await listShipmentBoxes(shipment.accountId, shipment.inboundPlanId, sid)
      for (const b of boxes) {
        const raw = b.trackingId ?? b.trackingNumber ?? ''
        trackingIds.push(String(raw).trim())
      }
    } catch { /* skip this shipment's boxes */ }
  }

  // Map to our boxes by order (boxNumber asc). Only write where Amazon gave a value.
  let updated = 0
  for (let i = 0; i < shipment.boxes.length; i++) {
    const t = trackingIds[i]
    if (t && shipment.boxes[i].trackingNumber !== t) {
      await prisma.fbaShipmentBox.update({ where: { id: shipment.boxes[i].id }, data: { trackingNumber: t } })
      updated++
    }
  }

  const tracked = await prisma.fbaShipmentBox.count({
    where: { shipmentId: fbaShipmentId, trackingNumber: { not: null } },
  })
  return { updated, total: shipment.boxes.length, tracked }
}
