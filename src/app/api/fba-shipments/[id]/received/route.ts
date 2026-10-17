/**
 * GET /api/fba-shipments/[id]/received
 *
 * Returns received vs shipped counts per Amazon sub-shipment.
 * Calls the v0 SP-API to get QuantityReceived for each confirmationId.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { getShipmentItemsV0 } from '@/lib/amazon/fba-inbound'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id },
    select: { accountId: true, labelData: true, shipmentConfirmationId: true, createdAt: true },
  })
  if (!shipment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Extract confirmationIds from labelData
  const confirmationIds: string[] = []
  try {
    const parsed = JSON.parse(shipment.labelData ?? '[]')
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (entry?.confirmationId) confirmationIds.push(entry.confirmationId)
      }
    }
  } catch { /* ignore */ }

  // Fallback to top-level field
  if (confirmationIds.length === 0 && shipment.shipmentConfirmationId) {
    confirmationIds.push(shipment.shipmentConfirmationId)
  }

  if (confirmationIds.length === 0) {
    return NextResponse.json({ byShipment: {}, totalReceived: 0, totalShipped: 0, reimbursed: 0, reconciled: 0 })
  }

  const byShipment: Record<string, { received: number; shipped: number }> = {}
  let totalReceived = 0
  let totalShipped = 0
  // Per-SKU shipped/received so we can cap the reimbursement offset at each SKU's
  // actual shortage. Track both seller SKU and FNSKU to match reimbursements.
  const skuAgg = new Map<string, { shipped: number; received: number; fnsku: string | null }>()
  const fnskus = new Set<string>()

  for (const cid of confirmationIds) {
    try {
      const items = await getShipmentItemsV0(shipment.accountId, cid)
      let received = 0
      let shipped = 0
      for (const item of items) {
        received += item.QuantityReceived ?? 0
        shipped += item.QuantityShipped ?? 0
        const key = item.SellerSKU
        const a = skuAgg.get(key) ?? { shipped: 0, received: 0, fnsku: item.FulfillmentNetworkSKU || null }
        a.shipped += item.QuantityShipped ?? 0
        a.received += item.QuantityReceived ?? 0
        if (!a.fnsku && item.FulfillmentNetworkSKU) a.fnsku = item.FulfillmentNetworkSKU
        skuAgg.set(key, a)
        if (item.FulfillmentNetworkSKU) fnskus.add(item.FulfillmentNetworkSKU)
      }
      byShipment[cid] = { received, shipped }
      totalReceived += received
      totalShipped += shipped
    } catch {
      byShipment[cid] = { received: 0, shipped: 0 }
    }
  }

  // ── Net out Lost_Inbound reimbursements (units Amazon lost on the way in and
  //    paid us for — i.e. the shipment was "made whole"). Only Lost_Inbound:
  //    Damaged_Inbound is for units that WERE received then damaged, so it would
  //    overstate receipts. Reimbursement rows carry no inbound-shipment id, so we
  //    match by SKU / FNSKU and only consider reimbursements approved on/after the
  //    shipment was created, then cap each SKU's offset at its real shortage. ──
  const skus = Array.from(skuAgg.keys())
  let totalReimbursed = 0
  if (skus.length > 0 || fnskus.size > 0) {
    const reimbs = await prisma.fbaReimbursement.findMany({
      where: {
        accountId: shipment.accountId,
        reason: 'Lost_Inbound',
        OR: [
          { sku: { in: skus } },
          ...(fnskus.size > 0 ? [{ fnsku: { in: Array.from(fnskus) } }] : []),
        ],
      },
      select: { sku: true, fnsku: true, quantityReimbursedTotal: true, approvalDate: true },
    }).catch(() => [])

    // Sum reimbursed units per shipment SKU (match by sku, else by fnsku).
    const reimbBySku = new Map<string, number>()
    const fnskuToSku = new Map<string, string>()
    for (const [sku, a] of Array.from(skuAgg.entries())) if (a.fnsku) fnskuToSku.set(a.fnsku, sku)
    for (const r of reimbs) {
      if (r.approvalDate && r.approvalDate < shipment.createdAt) continue // not this shipment's era
      const units = r.quantityReimbursedTotal ?? 0
      if (units <= 0) continue
      const sku = skuAgg.has(r.sku) ? r.sku : (r.fnsku ? fnskuToSku.get(r.fnsku) : undefined)
      if (!sku) continue
      reimbBySku.set(sku, (reimbBySku.get(sku) ?? 0) + units)
    }
    for (const [sku, a] of Array.from(skuAgg.entries())) {
      const shortage = Math.max(0, a.shipped - a.received)
      if (shortage <= 0) continue
      totalReimbursed += Math.min(shortage, reimbBySku.get(sku) ?? 0)
    }
  }

  const reconciled = Math.min(totalShipped, totalReceived + totalReimbursed)

  return NextResponse.json({ byShipment, totalReceived, totalShipped, reimbursed: totalReimbursed, reconciled })
}
