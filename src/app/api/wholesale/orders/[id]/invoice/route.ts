import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

function calcTotals(
  items: Array<{ quantity: number; unitPrice: number; discount: number; taxable: boolean }>,
  discountPct: number,
  taxRate: number,
  shippingCost: number,
) {
  const lineItems = items.map((item) => {
    const lineGross = item.quantity * item.unitPrice
    const lineDisc = lineGross * (item.discount / 100)
    return { ...item, lineTotal: lineGross - lineDisc }
  })
  const subtotal = lineItems.reduce((s, i) => s + i.lineTotal, 0)
  const discountAmt = subtotal * (discountPct / 100)
  const taxableSum = lineItems.filter((i) => i.taxable).reduce((s, i) => s + i.lineTotal, 0)
  const taxableAfterDiscount = subtotal > 0 ? taxableSum * (1 - discountPct / 100) : 0
  const taxAmt = taxableAfterDiscount * (taxRate / 100)
  const total = subtotal - discountAmt + taxAmt + shippingCost
  return { subtotal, discountAmt, taxAmt, total }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: { items: true },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (order.status !== 'CONFIRMED') {
    return NextResponse.json({ error: 'Order must be CONFIRMED to invoice' }, { status: 400 })
  }
  if (order.fulfillmentStatus !== 'SHIPPED') {
    return NextResponse.json({ error: 'Order must be SHIPPED to invoice' }, { status: 400 })
  }

  const body = await req.json()
  const {
    additionalItems = [],
    shippingCost,
    notes,
  } = body as {
    additionalItems?: Array<{ title: string; quantity: number; unitPrice: number }>
    shippingCost?: number
    notes?: string
  }

  // Generate invoice number from order number: SO1001 → INV1001
  const numMatch = order.orderNumber.match(/SO-?(\d+)/)
  const invoiceNumber = numMatch ? `INV${numMatch[1]}` : `INV-${order.orderNumber}`

  const updated = await prisma.$transaction(async (tx) => {
    // Create additional line items if any
    if (additionalItems.length > 0) {
      await tx.salesOrderItem.createMany({
        data: additionalItems.map((item) => ({
          orderId: order.id,
          title: item.title.trim(),
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          discount: 0,
          total: Number(item.quantity) * Number(item.unitPrice),
          taxable: false,
          isInvoiceAddon: true,
        })),
      })
    }

    // Fetch all items (original + addon)
    const allItems = await tx.salesOrderItem.findMany({
      where: { orderId: order.id },
    })

    const finalShipping = shippingCost !== undefined ? Number(shippingCost) : Number(order.shippingCost)

    const { subtotal, discountAmt, taxAmt, total } = calcTotals(
      allItems.map((i) => ({
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        discount: Number(i.discount),
        taxable: i.taxable,
      })),
      Number(order.discountPct),
      Number(order.taxRate),
      finalShipping,
    )

    const balance = total - Number(order.paidAmount)

    return tx.salesOrder.update({
      where: { id: order.id },
      data: {
        status: 'INVOICED',
        invoiceNumber,
        invoicedAt: new Date(),
        subtotal,
        discountAmt,
        taxAmt,
        shippingCost: finalShipping,
        total,
        balance,
        ...(notes !== undefined && { notes: notes.trim() || null }),
      },
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
  })

  return NextResponse.json(updated)
}
