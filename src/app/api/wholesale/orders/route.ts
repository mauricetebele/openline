import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { addDays } from 'date-fns'

const TERMS_DAYS: Record<string, number> = {
  NET_15: 15, NET_30: 30, NET_60: 60, NET_90: 90, DUE_ON_RECEIPT: 0,
}

function calcTotals(items: Array<{
  quantity: number; unitPrice: number; discount: number; taxable: boolean
}>, discountPct: number, taxRate: number, shippingCost: number) {
  const lineItems = items.map((item) => {
    const lineGross = item.quantity * item.unitPrice
    const lineDisc  = lineGross * (item.discount / 100)
    return { ...item, lineTotal: lineGross - lineDisc }
  })
  const subtotal     = lineItems.reduce((s, i) => s + i.lineTotal, 0)
  const discountAmt  = subtotal * (discountPct / 100)
  const afterDiscount = subtotal - discountAmt
  const taxableAmt   = lineItems
    .filter((i) => i.taxable)
    .reduce((s, i) => s + i.lineTotal, 0) - (lineItems.filter((i) => i.taxable).reduce((s, i) => s + i.lineTotal, 0) / subtotal || 0) * discountAmt
  const taxAmt  = (taxableAmt * (taxRate / 100))
  const total   = afterDiscount + taxAmt + shippingCost
  return { subtotal, discountAmt, taxAmt, total, lineItems }
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const status     = searchParams.get('status')
  const customerId = searchParams.get('customerId')
  const search     = searchParams.get('search')?.trim()
  const page       = parseInt(searchParams.get('page') ?? '1')
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const skip       = (page - 1) * limit

  const where: Record<string, unknown> = {}
  if (status)     where.status     = status
  if (customerId) where.customerId = customerId
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { customer: { companyName: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [orders, total] = await Promise.all([
    prisma.salesOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        customer: { select: { id: true, companyName: true } },
        items: true,
      },
    }),
    prisma.salesOrder.count({ where }),
  ])

  return NextResponse.json({ data: orders, total, page, limit })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    customerId, orderDate, paymentTerms, shippingAddressId, billingAddressId,
    notes, internalNotes, discountPct = 0, taxRate = 0, shippingCost = 0, items = [],
  } = body

  if (!customerId) return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
  if (!items.length) return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })

  const order = await prisma.$transaction(async (tx) => {
    const customer = await tx.wholesaleCustomer.findUnique({
      where: { id: customerId },
      include: { addresses: true },
    })
    if (!customer) throw new Error('Customer not found')

    // Generate order number
    const lastOrder = await tx.salesOrder.findFirst({ orderBy: { orderNumber: 'desc' } })
    let nextNum = 1
    if (lastOrder) {
      const match = lastOrder.orderNumber.match(/SO-(\d+)/)
      if (match) nextNum = parseInt(match[1]) + 1
    }
    const orderNumber = `SO-${String(nextNum).padStart(4, '0')}`

    // Due date
    const oDate   = orderDate ? new Date(orderDate) : new Date()
    const terms   = paymentTerms ?? customer.paymentTerms
    const daysOut = TERMS_DAYS[terms] ?? 30
    const dueDate = addDays(oDate, daysOut)

    // Address snapshots
    const shippingAddr = shippingAddressId
      ? customer.addresses.find((a) => a.id === shippingAddressId) ?? null
      : customer.addresses.find((a) => a.type === 'SHIPPING' && a.isDefault) ?? null

    const billingAddr = billingAddressId
      ? customer.addresses.find((a) => a.id === billingAddressId) ?? null
      : customer.addresses.find((a) => a.type === 'BILLING' && a.isDefault) ?? null

    // Totals
    const { subtotal, discountAmt, taxAmt, total, lineItems } = calcTotals(
      items.map((i: { quantity: number; unitPrice: number; discount?: number; taxable?: boolean }) => ({
        quantity:  Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        discount:  Number(i.discount ?? 0),
        taxable:   i.taxable ?? true,
      })),
      Number(discountPct),
      Number(taxRate),
      Number(shippingCost),
    )

    const so = await tx.salesOrder.create({
      data: {
        orderNumber,
        customerId,
        orderDate: oDate,
        dueDate,
        shippingAddress: shippingAddr ? JSON.parse(JSON.stringify(shippingAddr)) : null,
        billingAddress:  billingAddr  ? JSON.parse(JSON.stringify(billingAddr))  : null,
        subtotal,
        discountPct:  Number(discountPct),
        discountAmt,
        taxRate:      Number(taxRate),
        taxAmt,
        shippingCost: Number(shippingCost),
        total,
        balance:      total,
        notes:        notes?.trim() || null,
        internalNotes: internalNotes?.trim() || null,
        items: {
          create: lineItems.map((li, idx) => {
            const src = items[idx]
            return {
              productId:   src.productId || null,
              sku:         src.sku?.trim()   || null,
              title:       src.title?.trim() || 'Item',
              description: src.description?.trim() || null,
              quantity:    Number(src.quantity),
              unitPrice:   Number(src.unitPrice),
              discount:    Number(src.discount ?? 0),
              total:       li.lineTotal,
              taxable:     src.taxable ?? true,
            }
          }),
        },
      },
      include: { items: true, customer: true },
    })

    return so
  })

  return NextResponse.json(order, { status: 201 })
}
