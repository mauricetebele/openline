import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: {
      vendor: true,
      lines: {
        include: {
          product: {
            select: {
              id: true, description: true, sku: true, isSerializable: true,
            },
          },
          grade: { select: { id: true, grade: true } },
          costCode: { select: { id: true, name: true, amount: true } },
          receiptLines: { select: { qtyReceived: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Attach qtyReceived sum to each line
  const result = {
    ...po,
    lines: po.lines.map(l => ({
      ...l,
      qtyReceived: l.receiptLines.reduce((sum, rl) => sum + rl.qtyReceived, 0),
      receiptLines: undefined,
    })),
  }

  return NextResponse.json(result)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    select: { status: true, vendorId: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const isReceived = existing.status === 'RECEIVED'

  const body = await req.json()
  const { vendorId, date, notes, status, lines, vendorInvoiceBase64, vendorInvoiceFilename } = body

  if (!vendorId) return NextResponse.json({ error: 'Vendor is required' }, { status: 400 })
  if (!date)     return NextResponse.json({ error: 'Date is required' }, { status: 400 })
  if (!lines?.length) return NextResponse.json({ error: 'Add at least one line item' }, { status: 400 })

  const validStatuses = ['OPEN', 'RECEIVED', 'CANCELLED']
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  let po
  try {
  po = await prisma.$transaction(async (tx) => {
    // For partially received POs, we can't delete lines that have receipt records
    // (FK Restrict). Instead, upsert: update existing lines, create new ones,
    // and only delete lines with no receipts that aren't in the payload.
    const existingLines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: params.id },
      include: {
        _count: { select: { receiptLines: true } },
        receiptLines: { select: { qtyReceived: true } },
      },
    })

    type LineInput = { id?: string; productId: string; qty: number; unitCost: number; gradeId?: string | null; costCodeId?: string | null }
    const incomingLines = lines as LineInput[]

    // Match incoming lines to existing by id, or by productId+gradeId
    const usedExistingIds = new Set<string>()
    const toUpdate: { existingId: string; data: LineInput }[] = []
    const toCreate: LineInput[] = []

    for (const incoming of incomingLines) {
      // Try to match by id first
      let match = incoming.id ? existingLines.find(e => e.id === incoming.id) : undefined
      // Fall back to matching by productId + gradeId
      if (!match) {
        match = existingLines.find(e =>
          e.productId === incoming.productId &&
          (e.gradeId ?? null) === (incoming.gradeId ?? null) &&
          !usedExistingIds.has(e.id),
        )
      }
      if (match) {
        usedExistingIds.add(match.id)
        toUpdate.push({ existingId: match.id, data: incoming })
      } else {
        toCreate.push(incoming)
      }
    }

    // Received POs: only allow cost + costCode changes, no structural edits
    if (isReceived) {
      if (toCreate.length > 0) throw new Error('Cannot add new lines to a received PO')
      const unmatched = existingLines.filter(e => !usedExistingIds.has(e.id))
      if (unmatched.length > 0) throw new Error('Cannot remove lines from a received PO')
      for (const { existingId, data } of toUpdate) {
        const existing = existingLines.find(e => e.id === existingId)!
        if (data.productId !== existing.productId) throw new Error('Cannot change product on a received PO')
        if (Number(data.qty) !== existing.qty) throw new Error('Cannot change qty on a received PO — only cost can be edited')
        if ((data.gradeId ?? null) !== (existing.gradeId ?? null)) throw new Error('Cannot change grade on a received PO')
      }
    }

    // Validate: qty cannot be less than received qty
    for (const { existingId, data } of toUpdate) {
      const existing = existingLines.find(e => e.id === existingId)!
      const received = existing.receiptLines.reduce((sum, rl) => sum + rl.qtyReceived, 0)
      if (Number(data.qty) < received) {
        throw new Error(`Cannot reduce qty below ${received} received units for this line`)
      }
    }

    // Prevent removing lines that have receipts
    const cannotRemove = existingLines.filter(e => !usedExistingIds.has(e.id) && e._count.receiptLines > 0)
    if (cannotRemove.length > 0) {
      throw new Error('Cannot remove line items that have been partially received')
    }

    // Delete unreferenced lines that have no receipts
    const toDelete = existingLines.filter(e => !usedExistingIds.has(e.id) && e._count.receiptLines === 0)
    if (toDelete.length > 0) {
      await tx.purchaseOrderLine.deleteMany({ where: { id: { in: toDelete.map(d => d.id) } } })
    }

    // Update matched lines
    for (const { existingId, data } of toUpdate) {
      await tx.purchaseOrderLine.update({
        where: { id: existingId },
        data: {
          productId: data.productId,
          qty: Number(data.qty),
          unitCost: Number(data.unitCost),
          gradeId: data.gradeId || null,
          costCodeId: data.costCodeId || null,
        },
      })
    }

    // Create new lines
    if (toCreate.length > 0) {
      await tx.purchaseOrderLine.createMany({
        data: toCreate.map(l => ({
          purchaseOrderId: params.id,
          productId: l.productId,
          qty: Number(l.qty),
          unitCost: Number(l.unitCost),
          gradeId: l.gradeId || null,
          costCodeId: l.costCodeId || null,
        })),
      })
    }

    // Cascade vendor change to linked serials
    if (vendorId !== existing!.vendorId) {
      const receiptLineIds = await tx.pOReceiptLine.findMany({
        where: { purchaseOrderLine: { purchaseOrderId: params.id } },
        select: { id: true },
      })
      if (receiptLineIds.length > 0) {
        await tx.inventorySerial.updateMany({
          where: { receiptLineId: { in: receiptLineIds.map(r => r.id) } },
          data: { vendorId },
        })
      }
    }

    return tx.purchaseOrder.update({
      where: { id: params.id },
      data: {
        vendorId,
        date: new Date(date),
        notes: notes?.trim() || null,
        status: status ?? 'OPEN',
        ...(vendorInvoiceBase64 !== undefined ? { vendorInvoiceBase64: vendorInvoiceBase64 || null } : {}),
        ...(vendorInvoiceFilename !== undefined ? { vendorInvoiceFilename: vendorInvoiceFilename || null } : {}),
      },
      include: {
        vendor: { select: { id: true, vendorNumber: true, name: true } },
        lines: {
          include: {
            product: {
              select: {
                id: true, description: true, sku: true, isSerializable: true,
              },
            },
            grade: { select: { id: true, grade: true } },
            costCode: { select: { id: true, name: true, amount: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
  })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  return NextResponse.json(po)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Block deletion of any PO that has receipts — inventory integrity depends on those inbound movements
  const receiptCount = await prisma.pOReceipt.count({ where: { purchaseOrderId: params.id } })
  if (receiptCount > 0) {
    return NextResponse.json(
      { error: 'This PO has been partially or fully received and cannot be deleted. Inventory records depend on it.' },
      { status: 409 },
    )
  }

  await prisma.purchaseOrder.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
