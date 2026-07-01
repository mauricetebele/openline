import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

type Ctx = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { itemId, locationId, serials } = body as {
    itemId: string
    locationId: string
    serials: Array<{ serialNumber: string; note?: string }>
  }

  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
  if (!locationId) return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
  if (!serials?.length) return NextResponse.json({ error: 'At least one serial is required' }, { status: 400 })

  // Load the item with its parent RMA
  const item = await prisma.legacyRMAItem.findUnique({
    where: { id: itemId },
    include: { rma: true },
  })
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (item.rmaId !== params.id) return NextResponse.json({ error: 'Item does not belong to this RMA' }, { status: 400 })

  // ASCII-clean and uppercase serial numbers
  // eslint-disable-next-line no-control-regex
  const cleaned = serials.map(s => ({
    serialNumber: s.serialNumber.replace(/[^\x20-\x7E]/g, '').trim().toUpperCase(),
    note: s.note?.trim() || null,
  })).filter(s => s.serialNumber)

  if (!cleaned.length) return NextResponse.json({ error: 'No valid serial numbers' }, { status: 400 })

  // Duplicate check within submission
  const submittedSet = new Set<string>()
  for (const s of cleaned) {
    const key = `${item.productId}::${s.serialNumber}`
    if (submittedSet.has(key)) {
      return NextResponse.json({ error: `Duplicate serial number in submission: ${s.serialNumber}` }, { status: 400 })
    }
    submittedSet.add(key)
  }

  // Duplicate check against existing DB serials — block IN_STOCK
  const serialNumbers = cleaned.map(s => s.serialNumber)
  const lowerVariants = serialNumbers.map(s => s.toLowerCase())
  const allVariants = Array.from(new Set([...serialNumbers, ...lowerVariants]))

  const existing = await prisma.inventorySerial.findMany({
    where: { serialNumber: { in: allVariants } },
    select: { id: true, serialNumber: true, status: true, productId: true },
  })

  const inStock = existing.filter(e => e.status === 'IN_STOCK')
  if (inStock.length > 0) {
    return NextResponse.json({
      error: 'serials_in_stock',
      message: 'The following serials are already in stock',
      serials: inStock.map(e => e.serialNumber),
    }, { status: 409 })
  }

  // Execute in transaction
  try {
    const result = await prisma.$transaction(async (tx) => {
      const createdSerials: Array<{ inventorySerialId: string; serialNumber: string; note: string | null }> = []

      // Create InventorySerial + LegacyRMASerial for each serial
      for (const s of cleaned) {
        const invSerial = await tx.inventorySerial.create({
          data: {
            serialNumber: s.serialNumber,
            productId: item.productId,
            locationId,
            gradeId: item.gradeId || null,
            vendorId: item.vendorId || null,
            unitCost: item.unitCost,
            note: s.note,
            status: 'IN_STOCK',
          },
        })

        await tx.legacyRMASerial.create({
          data: {
            itemId: item.id,
            serialNumber: s.serialNumber,
            note: s.note,
            locationId,
            inventorySerialId: invSerial.id,
          },
        })

        createdSerials.push({
          inventorySerialId: invSerial.id,
          serialNumber: s.serialNumber,
          note: s.note,
        })
      }

      // Create SerialHistory entries
      await tx.serialHistory.createMany({
        data: createdSerials.map(s => ({
          inventorySerialId: s.inventorySerialId,
          eventType: 'LEGACY_RMA_RECEIPT',
          locationId,
          userId: user.dbId,
        })),
      })

      // Upsert InventoryItem qty
      const gradeId = item.gradeId || null
      const qty = cleaned.length
      if (gradeId) {
        await tx.inventoryItem.upsert({
          where: { productId_locationId_gradeId: { productId: item.productId, locationId, gradeId } },
          create: { productId: item.productId, locationId, gradeId, qty },
          update: { qty: { increment: qty } },
        })
      } else {
        const existingItem = await tx.inventoryItem.findFirst({
          where: { productId: item.productId, locationId, gradeId: null },
        })
        if (existingItem) {
          await tx.inventoryItem.update({
            where: { id: existingItem.id },
            data: { qty: { increment: qty } },
          })
        } else {
          await tx.inventoryItem.create({
            data: { productId: item.productId, locationId, gradeId: null, qty },
          })
        }
      }

      return { received: createdSerials.length }
    }, { timeout: 30000 })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error('[Legacy RMA Receive] Transaction error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
