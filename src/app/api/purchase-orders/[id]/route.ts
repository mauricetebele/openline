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
              grades: { select: { id: true, grade: true, description: true }, orderBy: { sortOrder: 'asc' } },
            },
          },
          grade: { select: { id: true, grade: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(po)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Block edits to fully received POs
  const existing = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    select: { status: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'RECEIVED') {
    return NextResponse.json({ error: 'Cannot edit a fully received PO' }, { status: 400 })
  }

  const body = await req.json()
  const { vendorId, date, notes, status, lines, vendorInvoiceBase64, vendorInvoiceFilename } = body

  if (!vendorId) return NextResponse.json({ error: 'Vendor is required' }, { status: 400 })
  if (!date)     return NextResponse.json({ error: 'Date is required' }, { status: 400 })
  if (!lines?.length) return NextResponse.json({ error: 'Add at least one line item' }, { status: 400 })

  const validStatuses = ['OPEN', 'RECEIVED', 'CANCELLED']
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const po = await prisma.$transaction(async (tx) => {
    // Replace all lines
    await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: params.id } })

    return tx.purchaseOrder.update({
      where: { id: params.id },
      data: {
        vendorId,
        date: new Date(date),
        notes: notes?.trim() || null,
        status: status ?? 'OPEN',
        ...(vendorInvoiceBase64 !== undefined ? { vendorInvoiceBase64: vendorInvoiceBase64 || null } : {}),
        ...(vendorInvoiceFilename !== undefined ? { vendorInvoiceFilename: vendorInvoiceFilename || null } : {}),
        lines: {
          create: lines.map((l: { productId: string; qty: number; unitCost: number; gradeId?: string | null }) => ({
            productId: l.productId,
            qty: Number(l.qty),
            unitCost: Number(l.unitCost),
            ...(l.gradeId ? { gradeId: l.gradeId } : {}),
          })),
        },
      },
      include: {
        vendor: { select: { id: true, vendorNumber: true, name: true } },
        lines: {
          include: {
            product: {
              select: {
                id: true, description: true, sku: true, isSerializable: true,
                grades: { select: { id: true, grade: true, description: true }, orderBy: { sortOrder: 'asc' } },
              },
            },
            grade: { select: { id: true, grade: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
  })

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
