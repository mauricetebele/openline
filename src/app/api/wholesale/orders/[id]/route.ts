import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

function calcTotals(items: Array<{
  quantity: number; unitPrice: number; discount: number; taxable: boolean
}>, discountPct: number, taxRate: number, shippingCost: number) {
  const lineItems = items.map((item) => {
    const lineGross = item.quantity * item.unitPrice
    const lineDisc  = lineGross * (item.discount / 100)
    return { ...item, lineTotal: lineGross - lineDisc }
  })
  const subtotal    = lineItems.reduce((s, i) => s + i.lineTotal, 0)
  const discountAmt = subtotal * (discountPct / 100)
  const taxableSum  = lineItems.filter((i) => i.taxable).reduce((s, i) => s + i.lineTotal, 0)
  const taxableAfterDiscount = subtotal > 0 ? taxableSum * (1 - discountPct / 100) : 0
  const taxAmt  = taxableAfterDiscount * (taxRate / 100)
  const total   = (subtotal - discountAmt) + taxAmt + shippingCost
  return { subtotal, discountAmt, taxAmt, total, lineItems }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: {
      items: { include: { product: true, grade: { select: { grade: true } } } },
      customer: { include: { addresses: true } },
      allocations: { include: { payment: true } },
      serialAssignments: {
        include: {
          inventorySerial: {
            select: { id: true, serialNumber: true, productId: true },
          },
        },
      },
    },
  })

  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(order)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.salesOrder.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Only DRAFT orders can be edited' }, { status: 400 })
  }

  const body = await req.json()
  const {
    customerPoNumber, notes, internalNotes, discountPct, taxRate, shippingCost, items,
  } = body

  const order = await prisma.$transaction(async (tx) => {
    if (items !== undefined) {
      await tx.salesOrderItem.deleteMany({ where: { orderId: params.id } })
    }

    const lineItems = items
      ? items.map((i: { quantity: number; unitPrice: number; discount?: number; taxable?: boolean }) => ({
          quantity:  Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          discount:  Number(i.discount ?? 0),
          taxable:   i.taxable ?? true,
        }))
      : []

    const { subtotal, discountAmt, taxAmt, total } = calcTotals(
      lineItems,
      Number(discountPct ?? existing.discountPct),
      Number(taxRate ?? existing.taxRate),
      Number(shippingCost ?? existing.shippingCost),
    )

    return tx.salesOrder.update({
      where: { id: params.id },
      data: {
        ...(customerPoNumber !== undefined && { customerPoNumber: customerPoNumber?.trim() || null }),
        ...(notes         !== undefined && { notes: notes?.trim() || null }),
        ...(internalNotes !== undefined && { internalNotes: internalNotes?.trim() || null }),
        ...(discountPct   !== undefined && { discountPct: Number(discountPct) }),
        ...(taxRate       !== undefined && { taxRate:     Number(taxRate) }),
        ...(shippingCost  !== undefined && { shippingCost: Number(shippingCost) }),
        ...(items !== undefined && {
          subtotal,
          discountAmt,
          taxAmt,
          total,
          balance: total,
          items: {
            create: items.map((src: {
              productId?: string; gradeId?: string; sku?: string; title?: string; description?: string;
              quantity: number; unitPrice: number; discount?: number; taxable?: boolean
            }, idx: number) => ({
              productId:   src.productId || null,
              gradeId:     src.gradeId || null,
              sku:         src.sku?.trim()   || null,
              title:       src.title?.trim() || 'Item',
              description: src.description?.trim() || null,
              quantity:    Number(src.quantity),
              unitPrice:   Number(src.unitPrice),
              discount:    Number(src.discount ?? 0),
              total:       lineItems[idx].lineTotal,
              taxable:     src.taxable ?? true,
            })),
          },
        }),
      },
      include: { items: true, customer: true },
    })
  })

  return NextResponse.json(order)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.salesOrder.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Only DRAFT orders can be deleted' }, { status: 400 })
  }

  await prisma.salesOrder.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
