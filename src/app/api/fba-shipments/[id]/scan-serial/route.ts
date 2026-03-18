/**
 * POST /api/fba-shipments/[id]/scan-serial
 * Scan serial(s) into an FBA shipment item.
 * Body: { serialNumber: string } OR { serialNumbers: string[] }
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

  const body = await req.json()

  // Accept single or bulk
  const inputSerials: string[] = Array.isArray(body.serialNumbers)
    ? body.serialNumbers.map((s: string) => s.trim()).filter(Boolean)
    : body.serialNumber ? [body.serialNumber.trim()] : []

  if (inputSerials.length === 0) {
    return NextResponse.json({ error: 'serialNumber or serialNumbers is required' }, { status: 400 })
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

  // Track current scanned counts per item (mutated as we assign)
  const scannedCounts = new Map(
    shipment.items.map(item => [item.id, item.serialAssignments.length]),
  )

  // Validate all serials before writing
  const resolved: Array<{
    serialId: string
    serialNumber: string
    locationId: string
    itemId: string
  }> = []
  const errors: string[] = []

  for (const sn of inputSerials) {
    const serial = await prisma.inventorySerial.findFirst({
      where: { serialNumber: { equals: sn, mode: 'insensitive' } },
      include: {
        product: { select: { sku: true } },
        grade: { select: { grade: true } },
        fbaShipmentAssignment: { select: { fbaShipmentId: true } },
      },
    })

    if (!serial) { errors.push(`"${sn}" not found`); continue }
    if (serial.status !== 'IN_STOCK') { errors.push(`"${sn}" not in stock (${serial.status})`); continue }
    if (serial.fbaShipmentAssignment && serial.fbaShipmentAssignment.fbaShipmentId !== params.id) {
      errors.push(`"${sn}" assigned to another shipment`); continue
    }
    if (serial.fbaShipmentAssignment?.fbaShipmentId === params.id) {
      errors.push(`"${sn}" already scanned`); continue
    }
    // Check not already in this batch
    if (resolved.some(r => r.serialId === serial.id)) {
      errors.push(`"${sn}" duplicate in batch`); continue
    }

    // Find matching item with remaining capacity
    let matchedItem = null
    for (const item of shipment.items) {
      if (!item.msku) continue
      if (item.msku.productId !== serial.productId) continue
      if (item.msku.gradeId !== serial.gradeId) continue
      if ((scannedCounts.get(item.id) ?? 0) < item.quantity) {
        matchedItem = item
        break
      }
    }

    if (!matchedItem) {
      const itemByProduct = shipment.items.find(i => i.msku?.productId === serial.productId)
      if (!itemByProduct) {
        errors.push(`"${sn}" SKU "${serial.product.sku}" not in shipment`)
      } else if (itemByProduct.msku && itemByProduct.msku.gradeId !== serial.gradeId) {
        errors.push(`"${sn}" grade "${serial.grade?.grade ?? 'No grade'}", expected "${itemByProduct.msku.grade?.grade ?? 'No grade'}"`)
      } else {
        errors.push(`"${sn}" — all units for "${serial.product.sku}" already scanned`)
      }
      continue
    }

    resolved.push({ serialId: serial.id, serialNumber: serial.serialNumber, locationId: serial.locationId, itemId: matchedItem.id })
    scannedCounts.set(matchedItem.id, (scannedCounts.get(matchedItem.id) ?? 0) + 1)
  }

  // For single-serial mode, fail on any error
  if (inputSerials.length === 1 && errors.length > 0) {
    return NextResponse.json({ error: errors[0] }, { status: 422 })
  }

  // For bulk, write what we can and report errors
  if (resolved.length > 0) {
    await prisma.$transaction(async tx => {
      for (const r of resolved) {
        await tx.fbaShipmentSerialAssignment.create({
          data: {
            fbaShipmentId: params.id,
            fbaShipmentItemId: r.itemId,
            inventorySerialId: r.serialId,
          },
        })
        await tx.serialHistory.create({
          data: {
            inventorySerialId: r.serialId,
            eventType: 'FBA_SHIPMENT',
            fbaShipmentId: params.id,
            locationId: r.locationId,
            notes: `Scanned for ${shipment.shipmentNumber ?? 'FBA shipment'}`,
          },
        })
      }
    })
  }

  return NextResponse.json({
    success: true,
    scanned: resolved.map(r => r.serialNumber),
    scannedCount: resolved.length,
    errors,
  })
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
