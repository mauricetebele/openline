/**
 * POST /api/fba-shipments/[id]/assign-inventory
 *
 * Step 2: Assign warehouse + reserve inventory for a DRAFT shipment.
 * Body: { warehouseId, assignments: [{ shipmentItemId, productId, locationId, gradeId?, quantity }] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { pushQtyForProducts } from '@/lib/push-qty-for-product'

export const dynamic = 'force-dynamic'

interface Assignment {
  shipmentItemId: string
  productId: string
  locationId: string
  gradeId?: string | null
  quantity: number
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { warehouseId: string; assignments: Assignment[] }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { warehouseId, assignments } = body
  if (!warehouseId || !assignments?.length) {
    return NextResponse.json({ error: 'warehouseId and assignments are required' }, { status: 400 })
  }

  // Load shipment
  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: { items: true, reservations: true },
  })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (shipment.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Shipment must be in DRAFT status' }, { status: 409 })
  }
  if (shipment.warehouseId && shipment.warehouseId !== warehouseId) {
    return NextResponse.json({ error: 'Shipment already assigned to a different warehouse' }, { status: 409 })
  }

  // Validate warehouse has complete address
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } })
  if (!warehouse) return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
  if (!warehouse.addressLine1 || !warehouse.city || !warehouse.state || !warehouse.postalCode) {
    return NextResponse.json({ error: 'Warehouse must have a complete shipping address' }, { status: 400 })
  }

  // Validate all shipmentItemIds belong to this shipment
  const itemIds = new Set(shipment.items.map(i => i.id))
  for (const a of assignments) {
    if (!itemIds.has(a.shipmentItemId)) {
      return NextResponse.json({ error: `Item ${a.shipmentItemId} does not belong to this shipment` }, { status: 400 })
    }
    if (a.quantity < 1) {
      return NextResponse.json({ error: 'Each assignment quantity must be at least 1' }, { status: 400 })
    }
  }

  // Validate inventory availability before transaction
  for (const a of assignments) {
    const gradeId = a.gradeId ?? null
    const inv = gradeId
      ? await prisma.inventoryItem.findUnique({
          where: { productId_locationId_gradeId: { productId: a.productId, locationId: a.locationId, gradeId } },
        })
      : await prisma.inventoryItem.findFirst({
          where: { productId: a.productId, locationId: a.locationId, gradeId: null },
        })
    if (!inv || inv.qty < a.quantity) {
      return NextResponse.json(
        { error: `Insufficient stock at location (available: ${inv?.qty ?? 0}, requested: ${a.quantity})` },
        { status: 409 },
      )
    }
  }

  // Execute in transaction: set warehouse, deduct inventory, create reservations
  await prisma.$transaction(async tx => {
    // Set warehouse on shipment
    await tx.fbaShipment.update({
      where: { id: params.id },
      data: { warehouseId },
    })

    for (const a of assignments) {
      const gradeId = a.gradeId ?? null

      // Deduct inventory
      if (gradeId) {
        await tx.inventoryItem.update({
          where: { productId_locationId_gradeId: { productId: a.productId, locationId: a.locationId, gradeId } },
          data: { qty: { decrement: a.quantity } },
        })
      } else {
        const inv = await tx.inventoryItem.findFirst({
          where: { productId: a.productId, locationId: a.locationId, gradeId: null },
        })
        if (!inv) throw new Error(`Inventory not found for product ${a.productId}`)
        await tx.inventoryItem.update({
          where: { id: inv.id },
          data: { qty: { decrement: a.quantity } },
        })
      }

      // Create reservation
      await tx.fbaInventoryReservation.create({
        data: {
          fbaShipmentId: params.id,
          productId: a.productId,
          locationId: a.locationId,
          gradeId,
          qtyReserved: a.quantity,
        },
      })
    }
  })

  // Push updated qty to marketplaces immediately (inventory was reserved for FBA)
  pushQtyForProducts(assignments.map(a => a.productId))

  return NextResponse.json({ success: true })
}
