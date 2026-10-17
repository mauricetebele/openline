/**
 * GET /api/fba-shipments/[id]/received
 *
 * Returns received vs shipped counts per Amazon sub-shipment.
 * Calls the v0 SP-API to get QuantityReceived for each confirmationId.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { getShipmentItemsV0, getShipmentSummariesV0 } from '@/lib/amazon/fba-inbound'

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
    select: { accountId: true, labelData: true, shipmentConfirmationId: true, createdAt: true, account: { select: { marketplaceId: true } } },
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
  let totalReimbursed = 0
  // Lost_Inbound reimbursement events for THIS shipment, surfaced for the detail
  // view. `attributed` = explicitly assigned to this shipment by hand (exact);
  // otherwise it's a heuristic SKU/shortage match (best-guess, capped).
  const reimbursementEvents: { reimbursementId: string; sku: string; fnsku: string | null; quantity: number; amountTotal: number | null; currency: string | null; approvalDate: Date | null; attributed: boolean }[] = []

  // 1. Exact: reimbursements manually attributed to THIS shipment — trusted fully.
  const attributedReimbs = await prisma.fbaReimbursement.findMany({
    where: { accountId: shipment.accountId, reason: 'Lost_Inbound', attributedShipmentId: id },
    select: { reimbursementId: true, sku: true, fnsku: true, quantityReimbursedTotal: true, amountTotal: true, currencyUnit: true, approvalDate: true },
  }).catch(() => [])
  for (const r of attributedReimbs) {
    const units = r.quantityReimbursedTotal ?? 0
    totalReimbursed += units
    reimbursementEvents.push({
      reimbursementId: r.reimbursementId,
      sku: r.sku || '—',
      fnsku: r.fnsku,
      quantity: units,
      amountTotal: r.amountTotal != null ? Number(r.amountTotal) : null,
      currency: r.currencyUnit ?? 'USD',
      approvalDate: r.approvalDate,
      attributed: true,
    })
  }

  // 2. Heuristic fallback — only UNattributed reimbursements, matched to a SKU this
  //    shipment actually came up short on, capped to that shortage. (Reimbursements
  //    attributed to another shipment are excluded entirely.) This keeps data useful
  //    before a reimbursement has been manually attributed.
  const shortageBySku = new Map<string, number>()
  for (const [sku, a] of Array.from(skuAgg.entries())) {
    const short = Math.max(0, a.shipped - a.received)
    if (short > 0) shortageBySku.set(sku, short)
  }
  if (shortageBySku.size > 0) {
    const shortageSkus = Array.from(shortageBySku.keys())
    const shortageFnskus = shortageSkus.map(s => skuAgg.get(s)?.fnsku).filter((x): x is string => !!x)
    const reimbs = await prisma.fbaReimbursement.findMany({
      where: {
        accountId: shipment.accountId,
        reason: 'Lost_Inbound',
        attributedShipmentId: null, // leave manually-attributed rows to step 1 / their own shipment
        OR: [
          { sku: { in: shortageSkus } },
          ...(shortageFnskus.length > 0 ? [{ fnsku: { in: shortageFnskus } }] : []),
        ],
      },
      select: { reimbursementId: true, sku: true, fnsku: true, quantityReimbursedTotal: true, amountTotal: true, currencyUnit: true, approvalDate: true },
    }).catch(() => [])

    const fnskuToSku = new Map<string, string>()
    for (const [sku, a] of Array.from(skuAgg.entries())) if (a.fnsku) fnskuToSku.set(a.fnsku, sku)

    const remaining = new Map(shortageBySku)
    const sorted = [...reimbs].sort((a, b) => (a.approvalDate?.getTime() ?? 0) - (b.approvalDate?.getTime() ?? 0))
    for (const r of sorted) {
      if (r.approvalDate && r.approvalDate < shipment.createdAt) continue // not this shipment's era
      const units = r.quantityReimbursedTotal ?? 0
      if (units <= 0) continue
      const sku = shortageBySku.has(r.sku) ? r.sku : (r.fnsku ? fnskuToSku.get(r.fnsku) : undefined)
      if (!sku) continue
      const left = remaining.get(sku) ?? 0
      if (left <= 0) continue
      const take = Math.min(units, left)
      remaining.set(sku, left - take)
      totalReimbursed += take
      const amt = r.amountTotal != null ? Number(r.amountTotal) : null
      reimbursementEvents.push({
        reimbursementId: r.reimbursementId,
        sku: r.sku || sku,
        fnsku: r.fnsku,
        quantity: take,
        amountTotal: amt != null ? (take === units ? amt : Math.round((amt * take / units) * 100) / 100) : null,
        currency: r.currencyUnit ?? 'USD',
        approvalDate: r.approvalDate,
        attributed: false,
      })
    }
  }
  reimbursementEvents.sort((a, b) => (b.approvalDate?.getTime() ?? 0) - (a.approvalDate?.getTime() ?? 0))

  const reconciled = Math.min(totalShipped, totalReceived + totalReimbursed)

  // A shortage is only final once Amazon has CLOSED the shipment(s); while a
  // shipment is still WORKING/IN_TRANSIT/RECEIVING, received < shipped is normal.
  let closed = false
  let amazonStatus: string | null = null
  // Receipt events grouped by receiving Amazon fulfillment center (warehouse).
  const byFc: { confirmationId: string; fulfillmentCenterId: string | null; shipmentName: string | null; shipped: number; received: number; status: string | null }[] = []
  try {
    const summaries = await getShipmentSummariesV0(shipment.accountId, shipment.account.marketplaceId, confirmationIds)
    const vals = confirmationIds.map(cid => summaries[cid]?.status).filter(Boolean) as string[]
    closed = vals.length > 0 && vals.every(v => v === 'CLOSED')
    const distinct = Array.from(new Set(vals))
    amazonStatus = distinct.length === 0 ? null : distinct.length === 1 ? distinct[0] : distinct.join(' / ')
    for (const cid of confirmationIds) {
      const s = summaries[cid]
      const counts = byShipment[cid] ?? { received: 0, shipped: 0 }
      byFc.push({
        confirmationId: cid,
        fulfillmentCenterId: s?.destinationFc ?? null,
        shipmentName: s?.name ?? null,
        shipped: counts.shipped,
        received: counts.received,
        status: s?.status ?? null,
      })
    }
  } catch {
    // unknown → treat as not closed (don't flag shortage); still surface counts
    for (const cid of confirmationIds) {
      const counts = byShipment[cid] ?? { received: 0, shipped: 0 }
      byFc.push({ confirmationId: cid, fulfillmentCenterId: null, shipmentName: null, shipped: counts.shipped, received: counts.received, status: null })
    }
  }

  return NextResponse.json({ byShipment, byFc, totalReceived, totalShipped, reimbursed: totalReimbursed, reconciled, closed, amazonStatus, reimbursementEvents })
}
