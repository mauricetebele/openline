/**
 * GET /api/removal-shipments/:id — Single shipment with all items + titles + receive progress
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const shipment = await prisma.removalShipment.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          _count: { select: { fbaReturnReceipts: true, fbaRemovalCases: true } },
        },
      },
      fbaReturnReceipts: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          receiptNumber: true,
          serialNumber: true,
          sku: true,
          lpnNumber: true,
          returnReason: true,
          customerComments: true,
          note: true,
          receivedAt: true,
          grade: { select: { grade: true } },
          previousGradeId: true,
          location: { select: { name: true, warehouse: { select: { name: true } } } },
          receivedBy: { select: { name: true } },
          product: { select: { description: true } },
          removalShipmentItemId: true,
        },
      },
    },
  })

  if (!shipment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Look up titles from SellerListing by SKU
  const skus = Array.from(new Set(shipment.items.map(i => i.sellerSku).filter(Boolean)))
  const listings = skus.length > 0
    ? await prisma.sellerListing.findMany({
        where: { sku: { in: skus }, productTitle: { not: null } },
        select: { sku: true, productTitle: true },
        distinct: ['sku'],
      })
    : []

  const titleMap = new Map(listings.map(l => [l.sku, l.productTitle]))

  // Build a map of shipmentItemId → LPN from receipts
  const itemLpnMap = new Map<string, string>()
  for (const r of shipment.fbaReturnReceipts) {
    if (r.removalShipmentItemId && r.lpnNumber && !itemLpnMap.has(r.removalShipmentItemId)) {
      itemLpnMap.set(r.removalShipmentItemId, r.lpnNumber)
    }
  }

  const items = shipment.items.map(item => {
    // A unit counts as received if it has a return receipt OR is marked "No Unit To
    // Receive". A removal case alone does NOT count (received + case = 1 via receipt).
    const receivedCount = Math.min(item._count.fbaReturnReceipts + item.noUnitToReceiveQty, item.quantity)
    return {
      id: item.id,
      shipmentId: item.shipmentId,
      sellerSku: item.sellerSku,
      fnsku: item.fnsku,
      disposition: item.disposition,
      quantity: item.quantity,
      title: titleMap.get(item.sellerSku) ?? null,
      receivedCount,
      remainingQty: Math.max(0, item.quantity - receivedCount),
      lpnNumber: itemLpnMap.get(item.id) ?? null,
      hasCase: item._count.fbaRemovalCases > 0,
      noUnitToReceiveQty: item.noUnitToReceiveQty,
    }
  })

  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0)
  const totalReceived = items.reduce((sum, i) => sum + i.receivedCount, 0)

  const receipts = shipment.fbaReturnReceipts.map(r => ({
    id: r.id,
    receiptNumber: r.receiptNumber,
    serialNumber: r.serialNumber,
    sku: r.sku,
    description: r.product?.description ?? null,
    lpnNumber: r.lpnNumber,
    returnReason: r.returnReason,
    customerComments: r.customerComments,
    grade: r.grade?.grade ?? null,
    regraded: !!r.previousGradeId,
    location: r.location ? `${r.location.warehouse.name} / ${r.location.name}` : null,
    note: r.note,
    receivedBy: r.receivedBy?.name ?? null,
    receivedAt: r.receivedAt,
  }))

  // Fallback: fill reason/comments by LPN for receipts stored before the returns
  // report synced (keeps the expanded Received Units view in step with the tab).
  const needLookup = receipts.filter(r => r.lpnNumber && !r.returnReason && !r.customerComments)
  if (needLookup.length > 0) {
    const rets = await prisma.fbaReturn.findMany({
      where: { lpn: { in: Array.from(new Set(needLookup.map(r => r.lpnNumber!))) } },
      orderBy: { returnDate: 'desc' },
      select: { lpn: true, reason: true, customerComments: true },
    })
    const byLpn = new Map<string, { reason: string | null; customerComments: string | null }>()
    for (const x of rets) if (x.lpn && !byLpn.has(x.lpn)) byLpn.set(x.lpn, { reason: x.reason, customerComments: x.customerComments })
    for (const r of receipts) {
      if (r.lpnNumber && !r.returnReason && !r.customerComments) {
        const m = byLpn.get(r.lpnNumber)
        if (m) { r.returnReason = m.reason; r.customerComments = m.customerComments }
      }
    }
  }

  // Fetch cases linked to this shipment
  const rawCases = await prisma.fbaRemovalCase.findMany({
    where: { removalShipmentId: id },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { name: true } } },
  })

  const cases = rawCases.map(c => ({
    id: c.id,
    removalOrderId: c.removalOrderId,
    trackingNumber: c.trackingNumber,
    lpnNumber: c.lpnNumber,
    fnsku: c.fnsku,
    sellerSku: c.sellerSku,
    productTitle: c.productTitle,
    note: c.note,
    createdBy: c.createdBy?.name ?? null,
    createdAt: c.createdAt,
  }))

  return NextResponse.json({
    id: shipment.id,
    removalOrderId: shipment.removalOrderId,
    trackingNumber: shipment.trackingNumber,
    carrier: shipment.carrier,
    orderType: shipment.orderType,
    shipDate: shipment.shipDate,
    requestDate: shipment.requestDate,
    items,
    receipts,
    cases,
    totalUnits,
    totalReceived,
  })
}
