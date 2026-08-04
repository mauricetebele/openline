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
          receiptLines: { select: { qtyReceived: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      ledgerEntry: { select: { id: true } },
    },
    orderBy: { poNumber: 'desc' },
  })

  // Flatten receiptLines into qtyReceived per line
  const data = orders.map(po => ({
    ...po,
    lines: po.lines.map(l => ({
      ...l,
      qtyReceived: l.receiptLines.reduce((sum, rl) => sum + rl.qtyReceived, 0),
      receiptLines: undefined,
    })),
  }))

  return NextResponse.json({ data })
}

interface POLineInput { productId: string; qty: number; unitCost: number; gradeId?: string | null; costCodeId?: string | null }
interface POInput {
  vendorId: string; date: string; notes?: string | null; lines: POLineInput[]
  vendorInvoiceBase64?: string | null; vendorInvoiceFilename?: string | null
}

const PO_INCLUDE = {
  vendor: { select: { id: true, vendorNumber: true, name: true } },
  lines: {
    include: {
      product: { select: { id: true, description: true, sku: true, isSerializable: true } },
      grade: { select: { id: true, grade: true } },
      costCode: { select: { id: true, name: true, amount: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
}

/** Returns an error string if the PO input is invalid, else null. */
function validatePOInput(p: POInput): string | null {
  if (!p.vendorId) return 'Vendor is required'
  if (!p.date)     return 'Date is required'
  if (!p.lines?.length) return 'Add at least one line item'
  for (let i = 0; i < p.lines.length; i++) {
    const line = p.lines[i]
    if (!line.productId) return `Line ${i + 1}: product is required`
    if (!line.qty || line.qty < 1) return `Line ${i + 1}: qty must be at least 1`
    if (line.unitCost === undefined || line.unitCost === null || Number(line.unitCost) < 0) {
      return `Line ${i + 1}: cost must be 0 or more`
    }
  }
  return null
}

function buildPOData(poNumber: number, p: POInput) {
  return {
    poNumber,
    vendorId: p.vendorId,
    date: new Date(p.date),
    notes: p.notes?.trim() || null,
    ...(p.vendorInvoiceBase64 !== undefined ? { vendorInvoiceBase64: p.vendorInvoiceBase64 || null } : {}),
    ...(p.vendorInvoiceFilename !== undefined ? { vendorInvoiceFilename: p.vendorInvoiceFilename || null } : {}),
    lines: {
      create: p.lines.map((l) => ({
        productId: l.productId,
        qty: Number(l.qty),
        unitCost: Number(l.unitCost),
        ...(l.gradeId ? { gradeId: l.gradeId } : {}),
        ...(l.costCodeId ? { costCodeId: l.costCodeId } : {}),
      })),
    },
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // ── Bulk multi-PO create (atomic) ──────────────────────────────────────────
  // Body { pos: [POInput, …] } → create N POs with consecutive poNumbers in a
  // single transaction (all-or-nothing). Used by the "Multi PO" spreadsheet
  // import that splits one sheet into several POs.
  if (Array.isArray(body.pos)) {
    const pos = body.pos as POInput[]
    if (pos.length === 0) return NextResponse.json({ error: 'No purchase orders to create' }, { status: 400 })
    for (let gi = 0; gi < pos.length; gi++) {
      const err = validatePOInput(pos[gi])
      if (err) return NextResponse.json({ error: `PO ${gi + 1}: ${err}` }, { status: 400 })
    }
    const created = await prisma.$transaction(async (tx) => {
      const max = await tx.purchaseOrder.findFirst({ orderBy: { poNumber: 'desc' }, select: { poNumber: true } })
      let next = max?.poNumber ?? 999
      const out = []
      for (const p of pos) {
        next += 1
        out.push(await tx.purchaseOrder.create({ data: buildPOData(next, p), include: PO_INCLUDE }))
      }
      return out
    })
    return NextResponse.json({ pos: created }, { status: 201 })
  }

  // ── Single PO create ────────────────────────────────────────────────────────
  const single = body as POInput
  const err = validatePOInput(single)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const po = await prisma.$transaction(async (tx) => {
    const max = await tx.purchaseOrder.findFirst({ orderBy: { poNumber: 'desc' }, select: { poNumber: true } })
    const nextNumber = (max?.poNumber ?? 999) + 1
    return tx.purchaseOrder.create({ data: buildPOData(nextNumber, single), include: PO_INCLUDE })
  })

  return NextResponse.json(po, { status: 201 })
}
