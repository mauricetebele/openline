/**
 * POST /api/fba-shipments/[id]/scan-serial
 * Scan a single serial number into an FBA shipment item.
 *
 * DELETE /api/fba-shipments/[id]/scan-serial
 * Remove a scanned serial assignment.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { serialNumber } = await req.json()
  if (!serialNumber || typeof serialNumber !== 'string') {
    return NextResponse.json({ error: 'serialNumber is required' }, { status: 400 })
  }

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: {
      items: {
        include: {
          msku: {
            select: {
              productId: true,
              gradeId: true,
              product: { select: { sku: true } },
              grade: { select: { grade: true } },
            },
          },
          serialAssignments: true,
        },
      },
      reservations: true,
    },
  })

  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (shipment.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Shipment must be in DRAFT status to scan serials' }, { status: 409 })
  }
  if (shipment.reservations.length === 0) {
    return NextResponse.json({ error: 'Inventory must be reserved before scanning serials' }, { status: 400 })
  }

  // Find the serial (case-insensitive)
  const serial = await prisma.inventorySerial.findFirst({
    where: { serialNumber: { equals: serialNumber, mode: 'insensitive' } },
    include: {
      product: { select: { sku: true } },
      grade: { select: { grade: true } },
      fbaShipmentAssignment: { select: { fbaShipmentId: true } },
    },
  })

  if (!serial) {
    return NextResponse.json({ error: `Serial "${serialNumber}" not found in inventory` }, { status: 422 })
  }
  if (serial.status !== 'IN_STOCK') {
    return NextResponse.json({ error: `Serial "${serialNumber}" is not in stock (status: ${serial.status})` }, { status: 422 })
  }
  if (serial.fbaShipmentAssignment && serial.fbaShipmentAssignment.fbaShipmentId !== params.id) {
    return NextResponse.json({ error: `Serial "${serialNumber}" is already assigned to another FBA shipment` }, { status: 422 })
  }
  if (serial.fbaShipmentAssignment?.fbaShipmentId === params.id) {
    return NextResponse.json({ error: `Serial "${serialNumber}" is already scanned for this shipment` }, { status: 422 })
  }

  // Find a matching item (by product + grade via MSKU)
  let matchedItem = null
  for (const item of shipment.items) {
    if (!item.msku) continue
    const productMatch = item.msku.productId === serial.productId
    const gradeMatch = item.msku.gradeId === serial.gradeId
    if (!productMatch || !gradeMatch) continue

    // Check item not fully scanned
    const scannedCount = item.serialAssignments.length
    if (scannedCount < item.quantity) {
      matchedItem = item
      break
    }
  }

  if (!matchedItem) {
    // Provide specific error
    const itemByProduct = shipment.items.find(i => i.msku?.productId === serial.productId)
    if (!itemByProduct) {
      return NextResponse.json(
        { error: `Serial "${serialNumber}" belongs to SKU "${serial.product.sku}", which is not in this shipment` },
        { status: 422 },
      )
    }
    if (itemByProduct.msku && itemByProduct.msku.gradeId !== serial.gradeId) {
      return NextResponse.json(
        { error: `Serial "${serialNumber}" is grade "${serial.grade?.grade ?? 'No grade'}", expected "${itemByProduct.msku.grade?.grade ?? 'No grade'}"` },
        { status: 422 },
      )
    }
    return NextResponse.json(
      { error: `All units for "${serial.product.sku}" are already scanned` },
      { status: 422 },
    )
  }

  // Transaction: create assignment + history
  await prisma.$transaction(async tx => {
    await tx.fbaShipmentSerialAssignment.create({
      data: {
        fbaShipmentId: params.id,
        fbaShipmentItemId: matchedItem!.id,
        inventorySerialId: serial.id,
      },
    })

    await tx.serialHistory.create({
      data: {
        inventorySerialId: serial.id,
        eventType: 'FBA_SHIPMENT',
        fbaShipmentId: params.id,
        locationId: serial.locationId,
        notes: `Scanned for ${shipment.shipmentNumber ?? 'FBA shipment'}`,
      },
    })
  })

  return NextResponse.json({ success: true, serialNumber: serial.serialNumber, itemId: matchedItem.id })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { serialNumber } = await req.json()
  if (!serialNumber) {
    return NextResponse.json({ error: 'serialNumber is required' }, { status: 400 })
  }

  const shipment = await prisma.fbaShipment.findUnique({ where: { id: params.id } })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (shipment.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Can only remove serials in DRAFT status' }, { status: 409 })
  }

  // Find the assignment
  const serial = await prisma.inventorySerial.findFirst({
    where: { serialNumber: { equals: serialNumber, mode: 'insensitive' } },
  })
  if (!serial) return NextResponse.json({ error: 'Serial not found' }, { status: 404 })

  const assignment = await prisma.fbaShipmentSerialAssignment.findFirst({
    where: { fbaShipmentId: params.id, inventorySerialId: serial.id },
  })
  if (!assignment) return NextResponse.json({ error: 'Serial is not assigned to this shipment' }, { status: 404 })

  await prisma.$transaction(async tx => {
    await tx.fbaShipmentSerialAssignment.delete({ where: { id: assignment.id } })

    await tx.serialHistory.create({
      data: {
        inventorySerialId: serial.id,
        eventType: 'UNASSIGNED',
        fbaShipmentId: params.id,
        locationId: serial.locationId,
        notes: `Removed from ${shipment.shipmentNumber ?? 'FBA shipment'}`,
      },
    })
  })

  return NextResponse.json({ success: true })
}
