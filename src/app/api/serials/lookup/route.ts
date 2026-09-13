import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

// Shared include for a full serial lookup (product, grade, location, history, and the
// receipt→PO line used to resolve landed unit cost).
const fullInclude = {
  product:  { select: { id: true, description: true, sku: true } },
  grade:    { select: { id: true, grade: true } },
  location: { include: { warehouse: { select: { name: true } } } },
  receiptLine: { select: { purchaseOrderLine: { select: { unitCost: true, costCode: { select: { amount: true } } } } } },
  history: {
    include: {
      receipt:       { select: { id: true, receivedAt: true } },
      purchaseOrder: { select: { id: true, poNumber: true, vendor: { select: { name: true } } } },
      order:         { select: { id: true, olmNumber: true, amazonOrderId: true, orderSource: true, shipToName: true, shipToCity: true, shipToState: true, orderTotal: true, currency: true, label: { select: { trackingNumber: true, carrier: true, serviceCode: true, shipmentCost: true } } } },
      salesOrder:    { select: { id: true, orderNumber: true, shipCarrier: true, shipTracking: true, shippingCost: true, total: true, customer: { select: { companyName: true } } } },
      location:      { select: { name: true, warehouse: { select: { name: true } } } },
      fromLocation:  { select: { name: true, warehouse: { select: { name: true } } } },
      fromProduct:   { select: { id: true, description: true, sku: true } },
      toProduct:     { select: { id: true, description: true, sku: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.InventorySerialInclude

/** Landed unit cost of the serial: PO-line unit cost (fallback to the serial's own
 *  unitCost) + its cost-code amount. Returns null when no cost is known. */
async function fetchFullWithCost(id: string) {
  const full = await prisma.inventorySerial.findUnique({ where: { id }, include: fullInclude })
  if (!full) return null
  const pol = full.receiptLine?.purchaseOrderLine
  const base = pol?.unitCost != null ? Number(pol.unitCost)
    : full.unitCost != null ? Number(full.unitCost)
    : null
  const costCode = pol?.costCode?.amount != null ? Number(pol.costCode.amount) : 0
  const unitCost = base != null ? Math.round((base + costCode) * 100) / 100 : null
  return { ...full, unitCost }
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sn = req.nextUrl.searchParams.get('sn')?.trim()
  if (!sn) return NextResponse.json({ error: 'Serial number is required' }, { status: 400 })

  try {
    // Check for exact match first, then fall back to partial (contains)
    const serial = await prisma.inventorySerial.findFirst({
      where: { serialNumber: { equals: sn, mode: 'insensitive' } },
      select: { id: true },
    })

    if (serial) {
      return NextResponse.json(await fetchFullWithCost(serial.id))
    }

    // Partial match — return list of matching serials (no history, lightweight)
    const matches = await prisma.inventorySerial.findMany({
      where: { serialNumber: { contains: sn, mode: 'insensitive' } },
      take: 50,
      orderBy: { serialNumber: 'asc' },
      include: {
        product:  { select: { id: true, description: true, sku: true } },
        grade:    { select: { id: true, grade: true } },
        location: { include: { warehouse: { select: { name: true } } } },
      },
    })

    if (matches.length === 0) {
      return NextResponse.json({ error: `No serial numbers matching "${sn}"` }, { status: 404 })
    }

    if (matches.length === 1) {
      return NextResponse.json(await fetchFullWithCost(matches[0].id))
    }

    // Multiple partial matches — return lightweight list
    return NextResponse.json({ matches })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[serials/lookup] Prisma error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
