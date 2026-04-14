import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { pushQtyForProducts } from '@/lib/push-qty-for-product'

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
      items: { include: { product: { include: { inventoryItems: { select: { qty: true, gradeId: true, grade: { select: { grade: true } } } } } }, grade: { select: { grade: true } } } },
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
  if (!['DRAFT', 'PENDING_APPROVAL'].includes(existing.status)) {
    return NextResponse.json({ error: 'Only unapproved orders can be edited' }, { status: 400 })
  }

  const body = await req.json()
  const {
    customerPoNumber, notes, internalNotes, discountPct, taxRate, shippingCost, items,
    shippingAddressId, billingAddressId, orderDate, paymentTerms,
  } = body

  const order = await prisma.$transaction(async (tx) => {
    if (items !== undefined) {
      await tx.salesOrderItem.deleteMany({ where: { orderId: params.id } })
    }

    // Resolve address snapshots if address IDs provided
    let addressData: Record<string, unknown> = {}
    if (shippingAddressId !== undefined || billingAddressId !== undefined) {
      const customer = await tx.wholesaleCustomer.findUnique({
        where: { id: existing.customerId },
        include: { addresses: true },
      })
      if (customer) {
        if (shippingAddressId !== undefined) {
          const addr = shippingAddressId
            ? customer.addresses.find((a) => a.id === shippingAddressId) ?? null
            : null
          addressData.shippingAddress = addr ? JSON.parse(JSON.stringify(addr)) : null
        }
        if (billingAddressId !== undefined) {
          const addr = billingAddressId
            ? customer.addresses.find((a) => a.id === billingAddressId) ?? null
            : null
          addressData.billingAddress = addr ? JSON.parse(JSON.stringify(addr)) : null
        }
      }
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
        ...(orderDate     !== undefined && { orderDate: new Date(orderDate) }),
        ...(paymentTerms  !== undefined && { paymentTerms }),
        ...addressData,
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

const DELETABLE_STATUSES = ['PENDING_APPROVAL', 'DRAFT', 'CONFIRMED']

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: { items: { select: { productId: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!DELETABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json(
      { error: 'Only non-invoiced orders can be deleted' },
      { status: 400 },
    )
  }

  // Collect product IDs for qty push after cleanup
  const productIds = existing.items.filter(i => i.productId).map(i => i.productId!)

  await prisma.$transaction(async (tx) => {
    // Release inventory reservations
    await tx.salesOrderInventoryReservation.deleteMany({ where: { salesOrderId: params.id } })

    // Revert serial assignments — set any OUT_OF_STOCK serials back to IN_STOCK
    const assignments = await tx.salesOrderSerialAssignment.findMany({
      where: { salesOrderId: params.id },
      include: { inventorySerial: { select: { id: true, status: true } } },
    })
    for (const sa of assignments) {
      if (sa.inventorySerial.status !== 'IN_STOCK') {
        await tx.inventorySerial.update({
          where: { id: sa.inventorySerial.id },
          data: { status: 'IN_STOCK' },
        })
      }
    }
    await tx.salesOrderSerialAssignment.deleteMany({ where: { salesOrderId: params.id } })

    // Remove any payment allocations (Restrict policy prevents cascade)
    await tx.paymentAllocation.deleteMany({ where: { orderId: params.id } })

    // Delete the order (cascade deletes items, etc.)
    await tx.salesOrder.delete({ where: { id: params.id } })
  })

  // Push updated qty to marketplaces since reservations were released
  if (productIds.length > 0) pushQtyForProducts(productIds)

  return NextResponse.json({ ok: true })
}
