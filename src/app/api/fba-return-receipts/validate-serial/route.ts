import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { serialNumber } = body as { serialNumber?: string }

  if (!serialNumber?.trim()) {
    return NextResponse.json({ error: 'Serial number is required' }, { status: 400 })
  }

  const serial = await prisma.inventorySerial.findFirst({
    where: { serialNumber: serialNumber.trim() },
    include: {
      product: { select: { id: true, sku: true, description: true } },
      grade: { select: { id: true, grade: true } },
      fbaShipmentAssignment: {
        include: {
          fbaShipment: {
            select: { id: true, shipmentNumber: true },
          },
        },
      },
    },
  })

  if (!serial) {
    return NextResponse.json({ error: 'Serial not found' }, { status: 404 })
  }

  if (serial.status !== 'OUT_OF_STOCK') {
    return NextResponse.json(
      { error: `Serial is ${serial.status} — must be OUT_OF_STOCK (shipped to FBA) to receive back` },
      { status: 400 },
    )
  }

  if (!serial.fbaShipmentAssignment) {
    // Check if serial was removed via Manual FBA
    const manualFbaEvent = await prisma.serialHistory.findFirst({
      where: {
        inventorySerialId: serial.id,
        eventType: 'MANUAL_REMOVE',
        notes: { startsWith: 'MANUAL FBA' },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!manualFbaEvent) {
      return NextResponse.json(
        { error: 'Serial has no active FBA shipment assignment — it may not have been shipped to FBA' },
        { status: 400 },
      )
    }

    return NextResponse.json({
      data: {
        inventorySerialId: serial.id,
        serialNumber: serial.serialNumber,
        productId: serial.productId,
        sku: serial.product.sku,
        description: serial.product.description,
        gradeId: serial.gradeId,
        grade: serial.grade?.grade ?? null,
        fbaShipmentId: null,
        fbaShipmentNumber: null,
      },
    })
  }

  return NextResponse.json({
    data: {
      inventorySerialId: serial.id,
      serialNumber: serial.serialNumber,
      productId: serial.productId,
      sku: serial.product.sku,
      description: serial.product.description,
      gradeId: serial.gradeId,
      grade: serial.grade?.grade ?? null,
      fbaShipmentId: serial.fbaShipmentAssignment.fbaShipmentId,
      fbaShipmentNumber: serial.fbaShipmentAssignment.fbaShipment.shipmentNumber,
    },
  })
}
