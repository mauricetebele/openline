import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

// ─── GET: List FBA Return Receipts ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const search = req.nextUrl.searchParams.get('search')?.trim()

  const where: Record<string, unknown> = {}
  if (search) {
    where.OR = [
      { receiptNumber: { contains: search, mode: 'insensitive' } },
      { serialNumber: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
    ]
  }

  const receipts = await prisma.fbaReturnReceipt.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      receiptNumber: true,
      serialNumber: true,
      sku: true,
      gradeId: true,
      previousGradeId: true,
      note: true,
      receivedAt: true,
      removalTrackingNumber: true,
      lpnNumber: true,
      createdAt: true,
      product: { select: { sku: true, description: true } },
      grade: { select: { id: true, grade: true } },
      location: {
        select: { name: true, warehouse: { select: { name: true } } },
      },
      fbaShipment: { select: { shipmentNumber: true } },
      removalShipment: { select: { trackingNumber: true } },
      receivedBy: { select: { name: true } },
    },
  })

  return NextResponse.json({ data: receipts })
}

// ─── POST: Receive Serial Back from FBA ──────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { inventorySerialId, locationId, gradeId, note, removalShipmentId, removalShipmentItemId, removalTrackingNumber, lpnNumber, createSerial, serialNumber, productId, unitCost, vendorId } = body as {
    inventorySerialId?: string
    locationId: string
    gradeId?: string | null
    note?: string
    removalShipmentId?: string
    removalShipmentItemId?: string
    removalTrackingNumber?: string
    lpnNumber?: string
    createSerial?: boolean
    serialNumber?: string
    productId?: string
    unitCost?: number
    vendorId?: string
  }

  if (!createSerial && !inventorySerialId) return NextResponse.json({ error: 'Serial is required' }, { status: 400 })
  if (createSerial && (!serialNumber?.trim() || !productId)) {
    return NextResponse.json({ error: 'serialNumber and productId are required when creating a new serial' }, { status: 400 })
  }
  if (!locationId) return NextResponse.json({ error: 'Location is required' }, { status: 400 })

  try {
    const result = await prisma.$transaction(async (tx) => {
      let resolvedSerialId: string
      let resolvedSerialNumber: string
      let resolvedProductId: string
      let resolvedSku: string
      let previousGradeId: string | null = null
      let finalGradeId: string | null = gradeId ?? null
      let fbaShipmentId: string | null = null
      let historyNotes: string

      if (createSerial) {
        // ── Override flow: create a brand-new serial record ──────────────
        const product = await tx.product.findUnique({
          where: { id: productId! },
          select: { id: true, sku: true },
        })
        if (!product) throw new Error('Product not found')

        // Ensure serial number doesn't already exist
        const existing = await tx.inventorySerial.findFirst({
          where: { serialNumber: serialNumber!.trim() },
        })
        if (existing) throw new Error(`Serial ${serialNumber!.trim()} already exists in the system`)

        const newSerial = await tx.inventorySerial.create({
          data: {
            serialNumber: serialNumber!.trim(),
            productId: product.id,
            locationId,
            gradeId: finalGradeId,
            status: 'IN_STOCK',
            note: note?.trim() || null,
            unitCost: unitCost != null ? unitCost : null,
            vendorId: vendorId || null,
          },
        })

        resolvedSerialId = newSerial.id
        resolvedSerialNumber = serialNumber!.trim()
        resolvedProductId = product.id
        resolvedSku = product.sku
        historyNotes = note?.trim() || 'FBA return — serial created via override (not previously in system)'
      } else {
        // ── Normal flow: re-validate existing serial ─────────────────────
        const serial = await tx.inventorySerial.findUnique({
          where: { id: inventorySerialId! },
          include: {
            product: { select: { id: true, sku: true, description: true } },
            grade: { select: { id: true, grade: true } },
            fbaShipmentAssignment: {
              include: {
                fbaShipment: { select: { id: true, shipmentNumber: true } },
              },
            },
          },
        })

        if (!serial) throw new Error('Serial not found')
        if (serial.status !== 'OUT_OF_STOCK') throw new Error('Serial is not OUT_OF_STOCK')

        const isManualFba = !serial.fbaShipmentAssignment
        if (isManualFba) {
          const manualFbaEvent = await tx.serialHistory.findFirst({
            where: {
              inventorySerialId: serial.id,
              eventType: 'MANUAL_REMOVE',
              notes: { startsWith: 'MANUAL FBA' },
            },
            orderBy: { createdAt: 'desc' },
          })
          if (!manualFbaEvent) throw new Error('Serial has no FBA shipment assignment')
        }

        previousGradeId = serial.gradeId
        finalGradeId = gradeId ?? serial.gradeId
        fbaShipmentId = serial.fbaShipmentAssignment?.fbaShipmentId ?? null
        resolvedSerialId = serial.id
        resolvedSerialNumber = serial.serialNumber
        resolvedProductId = serial.productId
        resolvedSku = serial.product.sku

        // Update InventorySerial → IN_STOCK, set location, optionally regrade
        await tx.inventorySerial.update({
          where: { id: inventorySerialId! },
          data: {
            status: 'IN_STOCK',
            locationId,
            gradeId: finalGradeId,
            note: note?.trim() || serial.note,
          },
        })

        // Delete FbaShipmentSerialAssignment (frees unique constraint for re-shipment)
        if (serial.fbaShipmentAssignment) {
          await tx.fbaShipmentSerialAssignment.delete({
            where: { id: serial.fbaShipmentAssignment.id },
          })
        }

        historyNotes = note?.trim() || (isManualFba
          ? 'Received back from Manual FBA'
          : `Received back from FBA shipment ${serial.fbaShipmentAssignment!.fbaShipment.shipmentNumber ?? ''}`.trim())
      }

      // Create SerialHistory event (FBA_RETURN)
      await tx.serialHistory.create({
        data: {
          inventorySerialId: resolvedSerialId,
          eventType: 'FBA_RETURN',
          locationId,
          fbaShipmentId,
          userId: user.dbId,
          notes: historyNotes,
        },
      })

      // Increment InventoryItem qty (upsert pattern)
      if (finalGradeId) {
        await tx.inventoryItem.upsert({
          where: {
            productId_locationId_gradeId: {
              productId: resolvedProductId,
              locationId,
              gradeId: finalGradeId,
            },
          },
          create: { productId: resolvedProductId, locationId, gradeId: finalGradeId, qty: 1 },
          update: { qty: { increment: 1 } },
        })
      } else {
        const existingInv = await tx.inventoryItem.findFirst({
          where: { productId: resolvedProductId, locationId, gradeId: null },
        })
        if (existingInv) {
          await tx.inventoryItem.update({ where: { id: existingInv.id }, data: { qty: { increment: 1 } } })
        } else {
          await tx.inventoryItem.create({ data: { productId: resolvedProductId, locationId, gradeId: null, qty: 1 } })
        }
      }

      // 6. Generate receipt number (FBA-RET-0001)
      const last = await tx.fbaReturnReceipt.findFirst({ orderBy: { createdAt: 'desc' } })
      let nextNum = 1
      if (last) {
        const match = last.receiptNumber.match(/FBA-RET-(\d+)/)
        if (match) nextNum = parseInt(match[1], 10) + 1
      }
      const receiptNumber = `FBA-RET-${String(nextNum).padStart(4, '0')}`

      // 7. Create FbaReturnReceipt record
      const receipt = await tx.fbaReturnReceipt.create({
        data: {
          receiptNumber,
          inventorySerialId: resolvedSerialId,
          productId: resolvedProductId,
          fbaShipmentId,
          serialNumber: resolvedSerialNumber,
          sku: resolvedSku,
          gradeId: finalGradeId,
          previousGradeId: gradeId && gradeId !== previousGradeId ? previousGradeId : null,
          locationId,
          note: note?.trim() || null,
          receivedById: user.dbId,
          removalShipmentId: removalShipmentId || null,
          removalShipmentItemId: removalShipmentItemId || null,
          removalTrackingNumber: removalTrackingNumber || null,
          lpnNumber: lpnNumber?.trim() || null,
        },
        include: {
          product: { select: { sku: true, description: true } },
          grade: { select: { id: true, grade: true } },
          location: {
            select: { name: true, warehouse: { select: { name: true } } },
          },
          fbaShipment: { select: { shipmentNumber: true } },
          receivedBy: { select: { name: true } },
        },
      })

      return receipt
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error('[FBA-Return] Transaction error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
