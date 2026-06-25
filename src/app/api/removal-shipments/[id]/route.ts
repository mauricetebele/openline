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
          _count: { select: { fbaReturnReceipts: true } },
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
          note: true,
          receivedAt: true,
          grade: { select: { grade: true } },
          previousGradeId: true,
          location: { select: { name: true, warehouse: { select: { name: true } } } },
          receivedBy: { select: { name: true } },
          product: { select: { description: true } },
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

  const items = shipment.items.map(item => ({
    id: item.id,
    shipmentId: item.shipmentId,
    sellerSku: item.sellerSku,
    fnsku: item.fnsku,
    disposition: item.disposition,
    quantity: item.quantity,
    title: titleMap.get(item.sellerSku) ?? null,
    receivedCount: item._count.fbaReturnReceipts,
    remainingQty: item.quantity - item._count.fbaReturnReceipts,
  }))

  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0)
  const totalReceived = items.reduce((sum, i) => sum + i.receivedCount, 0)

  const receipts = shipment.fbaReturnReceipts.map(r => ({
    id: r.id,
    receiptNumber: r.receiptNumber,
    serialNumber: r.serialNumber,
    sku: r.sku,
    description: r.product?.description ?? null,
    lpnNumber: r.lpnNumber,
    grade: r.grade?.grade ?? null,
    regraded: !!r.previousGradeId,
    location: r.location ? `${r.location.warehouse.name} / ${r.location.name}` : null,
    note: r.note,
    receivedBy: r.receivedBy?.name ?? null,
    receivedAt: r.receivedAt,
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
    totalUnits,
    totalReceived,
  })
}
