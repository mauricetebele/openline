import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { Decimal } from '@prisma/client/runtime/library'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { description, vendorInvoiceNo, adjustments } = body as {
    description?: string
    vendorInvoiceNo?: string
    adjustments?: { label: string; amount: number }[]
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: {
      lines: true,
      ledgerEntry: { select: { id: true } },
    },
  })

  if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 })

  if (po.ledgerEntry) {
    return NextResponse.json({ error: 'A bill has already been generated for this PO' }, { status: 409 })
  }

  // Calculate PO lines total
  const poTotal = po.lines.reduce(
    (sum, l) => sum.add(new Decimal(l.unitCost).mul(l.qty)),
    new Decimal(0),
  )

  // Calculate adjustments total
  const adjTotal = (adjustments ?? []).reduce(
    (sum, a) => sum.add(new Decimal(a.amount)),
    new Decimal(0),
  )

  const finalAmount = poTotal.add(adjTotal)
  if (finalAmount.lte(0)) {
    return NextResponse.json({ error: 'Bill total must be greater than zero' }, { status: 400 })
  }

  const entry = await prisma.vendorLedgerEntry.create({
    data: {
      vendorId: po.vendorId,
      type: 'DEBIT',
      amount: finalAmount,
      description: description?.trim() || `PO${(po as any).poNumber} bill`,
      vendorInvoiceNo: vendorInvoiceNo?.trim() || null,
      purchaseOrderId: po.id,
      adjustments: adjustments?.length
        ? {
            create: adjustments.map((a) => ({
              label: a.label,
              amount: a.amount,
            })),
          }
        : undefined,
    },
    include: {
      adjustments: true,
    },
  })

  return NextResponse.json(entry, { status: 201 })
}
