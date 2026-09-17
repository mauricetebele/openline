/**
 * Sync per-box tracking numbers for an FBA inbound shipment from Amazon.
 *
 * Reads tracking from the 2024-03-20 getShipment response (shipment.trackingDetails
 * → spd/ltl tracking items), falling back to the v0 transport resource. Each
 * tracking number is stored on the matching FbaShipmentBox (mapped by order →
 * boxNumber), which feeds the Live Shipping Manifest (one row per tracking number).
 *
 * Partnered small-parcel tracking is assigned by the carrier and only becomes
 * available around the time labels are generated, so this runs on-demand (button)
 * and is fired automatically when a shipment is marked shipped.
 */
import { prisma } from '@/lib/prisma'
import { getShipment, getTransportTrackingV0, listPlacementOptions } from '@/lib/amazon/fba-inbound'

export type SyncTrackingResult =
  | { updated: number; total: number; tracked: number; debug?: string }
  | { error: string; status?: number }

/** Pull tracking IDs out of a 2024-03-20 Shipment's trackingDetails (spd + ltl). */
function trackingFromShipment(details: unknown): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const td = (details as any)?.trackingDetails ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spd = td.spdTrackingDetail?.spdTrackingItems ?? td.spdTrackingDetail?.spdTrackingItemList ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ltl = td.ltlTrackingDetail?.ltlTrackingItems ?? []
  return [...spd, ...ltl]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((it: any) => String(it?.trackingId ?? it?.trackingID ?? it?.trackingNumber ?? '').trim())
    .filter(Boolean)
}

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

  // Pull tracking in box order across all Amazon shipments. Primary source is the
  // 2024 getShipment trackingDetails; if empty, fall back to the v0 transport
  // resource (needs the FBAxxx confirmationId).
  const trackingIds: string[] = []
  const dbg: string[] = []
  for (const sid of allShipmentIds) {
    try {
      const details = await getShipment(shipment.accountId, shipment.inboundPlanId, sid)
      let ids = trackingFromShipment(details)
      let via = 'trackingDetails'
      if (ids.length === 0) {
        const confirmationId =
          details.shipmentConfirmationId ?? details.amazonReferenceId ?? shipment.shipmentConfirmationId ?? null
        if (confirmationId) {
          const t = await getTransportTrackingV0(shipment.accountId, confirmationId).catch(() => [] as string[])
          ids = t
          via = `v0transport(${confirmationId})`
        }
      }
      trackingIds.push(...ids)
      dbg.push(`${sid.slice(0, 10)}:${via}=${ids.length}`)
    } catch (e) {
      dbg.push(`${sid.slice(0, 10)}:err=${e instanceof Error ? e.message.slice(0, 60) : 'x'}`)
    }
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
  return { updated, total: shipment.boxes.length, tracked, debug: dbg.join(' | ') }
}
