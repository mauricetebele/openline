import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')
  const search = searchParams.get('search')?.trim()

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}
  if (status) where.status = status

  if (search) {
    // Search by PO number, SKU (via line items), or serial (via receipts)
    const poNum = parseInt(search, 10)
    where.OR = [
      // PO number match
      ...(Number.isFinite(poNum) ? [{ poNumber: poNum }] : []),
      // Vendor name match
      { vendor: { name: { contains: search, mode: 'insensitive' } } },
      // SKU match (product on any line)
      { lines: { some: { product: { sku: { contains: search, mode: 'insensitive' } } } } },
      // Serial match (via receipt lines → serials)
      { receipts: { some: { lines: { some: { serials: { some: { serialNumber: { contains: search, mode: 'insensitive' } } } } } } } },
    ]
  }

  const orders = await prisma.purchaseOrder.findMany({
    where,
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      lines: {
        include: {
          product: { select: { id: true, description: true, sku: true, isSerializable: true } },
          grade: { select: { id: true, grade: true } },
          costCode: { select: { id: true, name: true, amount: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      ledgerEntry: { select: { id: true } },
    },
    orderBy: { poNumber: 'desc' },
  })

  return NextResponse.json({ data: orders })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { vendorId, date, notes, lines, vendorInvoiceBase64, vendorInvoiceFilename } = body

  if (!vendorId) return NextResponse.json({ error: 'Vendor is required' }, { status: 400 })
  if (!date)     return NextResponse.json({ error: 'Date is required' }, { status: 400 })
  if (!lines?.length) return NextResponse.json({ error: 'Add at least one line item' }, { status: 400 })

  for (const [i, line] of lines.entries()) {
    if (!line.productId) return NextResponse.json({ error: `Line ${i + 1}: product is required` }, { status: 400 })
    if (!line.qty || line.qty < 1) return NextResponse.json({ error: `Line ${i + 1}: qty must be at least 1` }, { status: 400 })
    if (line.unitCost === undefined || line.unitCost === null || Number(line.unitCost) < 0) {
      return NextResponse.json({ error: `Line ${i + 1}: cost must be 0 or more` }, { status: 400 })
    }
  }

  const po = await prisma.$transaction(async (tx) => {
    const max = await tx.purchaseOrder.findFirst({
      orderBy: { poNumber: 'desc' },
      select: { poNumber: true },
    })
    const nextNumber = (max?.poNumber ?? 999) + 1

    return tx.purchaseOrder.create({
      data: {
        poNumber: nextNumber,
        vendorId,
        date: new Date(date),
        notes: notes?.trim() || null,
        ...(vendorInvoiceBase64 !== undefined ? { vendorInvoiceBase64: vendorInvoiceBase64 || null } : {}),
        ...(vendorInvoiceFilename !== undefined ? { vendorInvoiceFilename: vendorInvoiceFilename || null } : {}),
        lines: {
          create: lines.map((l: { productId: string; qty: number; unitCost: number; gradeId?: string | null; costCodeId?: string | null }) => ({
            productId: l.productId,
            qty: Number(l.qty),
            unitCost: Number(l.unitCost),
            ...(l.gradeId ? { gradeId: l.gradeId } : {}),
            ...(l.costCodeId ? { costCodeId: l.costCodeId } : {}),
          })),
        },
      },
      include: {
        vendor: { select: { id: true, vendorNumber: true, name: true } },
        lines: {
          include: {
            product: { select: { id: true, description: true, sku: true, isSerializable: true } },
            grade: { select: { id: true, grade: true } },
            costCode: { select: { id: true, name: true, amount: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
  })

  return NextResponse.json(po, { status: 201 })
}
