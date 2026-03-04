import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const receipts = await prisma.pOReceipt.findMany({
    where: { purchaseOrderId: params.id },
    include: {
      lines: {
        include: {
          product:  { select: { id: true, description: true, sku: true } },
          location: { include: { warehouse: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { receivedAt: 'desc' },
  })

  return NextResponse.json({ data: receipts })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { notes, lines, confirmExisting } = body as {
    notes?: string
    confirmExisting?: boolean
    lines: Array<{
      purchaseOrderLineId: string
      productId: string
      qtyReceived: number
      locationId: string
      gradeId?: string | null
      serials?: string[]
    }>
  }

  if (!lines?.length) {
    return NextResponse.json({ error: 'No lines to receive' }, { status: 400 })
  }

  // Basic field validation
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.purchaseOrderLineId) {
      return NextResponse.json({ error: `Line ${i + 1}: purchaseOrderLineId missing` }, { status: 400 })
    }
    if (!line.locationId) {
      return NextResponse.json({ error: `Line ${i + 1}: location is required` }, { status: 400 })
    }
    if (!line.qtyReceived || line.qtyReceived < 1) {
      return NextResponse.json({ error: `Line ${i + 1}: qty must be at least 1` }, { status: 400 })
    }
  }

  // Load PO with all its lines and existing receipt totals
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: {
      lines: {
        include: {
          product: true,
          receiptLines: { select: { qtyReceived: true } },
        },
      },
    },
  })
  if (!po) return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })

  // Build map of PO line → remaining qty
  const poLineMap = new Map(
    po.lines.map(l => {
      const received = l.receiptLines.reduce((s, r) => s + r.qtyReceived, 0)
      return [l.id, { poLine: l, remaining: l.qty - received }]
    }),
  )

  // Validate qty, serial counts, collect all serials for duplicate checking
  const allSubmittedSerials: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line  = lines[i]
    const entry = poLineMap.get(line.purchaseOrderLineId)
    if (!entry) {
      return NextResponse.json({ error: `Line ${i + 1}: PO line not found` }, { status: 400 })
    }
    if (line.qtyReceived > entry.remaining) {
      return NextResponse.json(
        { error: `Line ${i + 1} (${entry.poLine.product.description}): tried to receive ${line.qtyReceived} but only ${entry.remaining} remain` },
        { status: 400 },
      )
    }
    if (entry.poLine.product.isSerializable) {
      if (!line.serials?.length) {
        return NextResponse.json(
          { error: `Line ${i + 1} (${entry.poLine.product.description}): serial numbers are required` },
          { status: 400 },
        )
      }
      const cleaned = line.serials.map((s: string) => s.trim()).filter(Boolean)
      if (cleaned.length !== line.qtyReceived) {
        return NextResponse.json(
          { error: `Line ${i + 1} (${entry.poLine.product.description}): ${cleaned.length} serial(s) provided but qty is ${line.qtyReceived}` },
          { status: 400 },
        )
      }
      allSubmittedSerials.push(...cleaned.map((s: string) => `${line.productId}::${s}`))
    }
  }

  // Duplicate check within the submission
  const submittedSet = new Set<string>()
  for (const key of allSubmittedSerials) {
    if (submittedSet.has(key)) {
      return NextResponse.json({ error: `Duplicate serial number in submission: ${key.split('::')[1]}` }, { status: 400 })
    }
    submittedSet.add(key)
  }

  // Duplicate check against existing DB serials
  const allWarnings: string[] = []
  for (const line of lines) {
    if (!line.serials?.length) continue
    const cleaned = line.serials.map((s: string) => s.trim()).filter(Boolean)
    const existing = await prisma.inventorySerial.findMany({
      where: { serialNumber: { in: cleaned } },
      select: { serialNumber: true, status: true, product: { select: { sku: true } } },
    })
    // Hard block: serials currently IN_STOCK
    const inStock = existing.filter(e => e.status === 'IN_STOCK')
    if (inStock.length > 0) {
      const dupes = inStock.map(e => `${e.serialNumber} (${e.product.sku})`).join(', ')
      return NextResponse.json({ error: `Serial(s) already IN_STOCK: ${dupes}` }, { status: 409 })
    }
    // Soft warning: serials exist but not in stock
    const notInStock = existing.filter(e => e.status !== 'IN_STOCK')
    for (const e of notInStock) {
      allWarnings.push(`${e.serialNumber} already exists as ${e.product.sku} (${e.status})`)
    }
  }
  if (allWarnings.length > 0 && !confirmExisting) {
    return NextResponse.json(
      { error: 'existing_serials_warning', warnings: allWarnings },
      { status: 409 },
    )
  }

  // Normalise gradeId: convert empty strings to null so Prisma doesn't reject them
  for (const line of lines) {
    if (!line.gradeId) line.gradeId = null
  }

  // All validation passed — execute in a single transaction
  try {
    const receipt = await prisma.$transaction(async (tx) => {
      // 1. Create the receipt + lines (without nested serials — we create them separately below)
      const newReceipt = await tx.pOReceipt.create({
        data: {
          purchaseOrderId: params.id,
          notes: notes?.trim() || null,
          lines: {
            create: lines.map(line => ({
              purchaseOrderLineId: line.purchaseOrderLineId,
              productId:           line.productId,
              qtyReceived:         line.qtyReceived,
              locationId:          line.locationId,
            })),
          },
        },
        include: {
          lines: true,  // need the created line IDs
        },
      })

      // 2. For each line that has serials, create InventorySerial + SerialHistory records
      for (const line of lines) {
        if (!line.serials?.length) continue

        const cleaned     = line.serials.map((s: string) => s.trim()).filter(Boolean)
        const receiptLine = newReceipt.lines.find(rl => rl.purchaseOrderLineId === line.purchaseOrderLineId)
        if (!receiptLine) continue

        for (const sn of cleaned) {
          // Create the serial record
          const serial = await tx.inventorySerial.create({
            data: {
              serialNumber:  sn,
              productId:     line.productId,
              locationId:    line.locationId,
              gradeId:       line.gradeId || null,
              receiptLineId: receiptLine.id,
              status:        'IN_STOCK',
            },
          })

          // Create the history entry
          await tx.serialHistory.create({
            data: {
              inventorySerialId: serial.id,
              eventType:         'PO_RECEIPT',
              receiptId:         newReceipt.id,
              purchaseOrderId:   params.id,
              locationId:        line.locationId,
            },
          })
        }
      }

      // 3. Upsert inventory quantities per product+location+grade
      //    Prisma's composite-unique upsert rejects null in the where clause,
      //    so when gradeId is null we fall back to manual find + update/create.
      for (const line of lines) {
        const gradeId = line.gradeId || null
        if (gradeId) {
          await tx.inventoryItem.upsert({
            where:  { productId_locationId_gradeId: { productId: line.productId, locationId: line.locationId, gradeId } },
            create: { productId: line.productId, locationId: line.locationId, gradeId, qty: line.qtyReceived },
            update: { qty: { increment: line.qtyReceived } },
          })
        } else {
          const existing = await tx.inventoryItem.findFirst({
            where: { productId: line.productId, locationId: line.locationId, gradeId: null },
          })
          if (existing) {
            await tx.inventoryItem.update({
              where: { id: existing.id },
              data:  { qty: { increment: line.qtyReceived } },
            })
          } else {
            await tx.inventoryItem.create({
              data: { productId: line.productId, locationId: line.locationId, gradeId: null, qty: line.qtyReceived },
            })
          }
        }
      }

      // 4. Check if PO is now fully received → update status
      const freshPO = await tx.purchaseOrder.findUnique({
        where:   { id: params.id },
        include: { lines: { include: { receiptLines: { select: { qtyReceived: true } } } } },
      })
      if (freshPO) {
        const fullyReceived = freshPO.lines.every(l => {
          const total = l.receiptLines.reduce((s, r) => s + r.qtyReceived, 0)
          return total >= l.qty
        })
        if (fullyReceived) {
          await tx.purchaseOrder.update({ where: { id: params.id }, data: { status: 'RECEIVED' } })
        }
      }

      // 5. Return the receipt with full details for the response
      return tx.pOReceipt.findUniqueOrThrow({
        where: { id: newReceipt.id },
        include: {
          lines: {
            include: {
              product:  { select: { id: true, description: true, sku: true } },
              location: { include: { warehouse: { select: { id: true, name: true } } } },
            },
          },
        },
      })
    })

    return NextResponse.json(receipt, { status: 201 })
  } catch (err) {
    console.error('[PO Receipt] Transaction error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
