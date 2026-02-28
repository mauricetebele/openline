import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search')?.trim()
  const activeParam = searchParams.get('active')

  const where: Record<string, unknown> = {}

  if (activeParam !== null) {
    where.active = activeParam !== 'false'
  }

  if (search) {
    where.OR = [
      { companyName: { contains: search, mode: 'insensitive' } },
      { contactName: { contains: search, mode: 'insensitive' } },
      { email:       { contains: search, mode: 'insensitive' } },
    ]
  }

  const customers = await prisma.wholesaleCustomer.findMany({
    where,
    orderBy: { companyName: 'asc' },
    include: {
      addresses: true,
      _count: { select: { salesOrders: true } },
      salesOrders: {
        where: { status: { in: ['INVOICED', 'PARTIALLY_PAID'] } },
        select: { balance: true },
      },
    },
  })

  const data = customers.map((c) => ({
    ...c,
    openBalance: c.salesOrders.reduce((sum, o) => sum + Number(o.balance), 0),
    salesOrders: undefined,
  }))

  return NextResponse.json({ data })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    companyName, contactName, phone, email, website,
    taxExempt, taxId, taxRate, creditLimit, paymentTerms,
    defaultDiscount, notes, active, addresses,
  } = body

  if (!companyName?.trim()) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
  }

  const customer = await prisma.$transaction(async (tx) => {
    const c = await tx.wholesaleCustomer.create({
      data: {
        companyName:     companyName.trim(),
        contactName:     contactName?.trim() || null,
        phone:           phone?.trim()   || null,
        email:           email?.trim()   || null,
        website:         website?.trim() || null,
        taxExempt:       taxExempt ?? false,
        taxId:           taxId?.trim()   || null,
        taxRate:         taxRate  ?? 0,
        creditLimit:     creditLimit ?? null,
        paymentTerms:    paymentTerms ?? 'NET_30',
        defaultDiscount: defaultDiscount ?? 0,
        notes:           notes?.trim() || null,
        active:          active ?? true,
      },
    })

    if (Array.isArray(addresses) && addresses.length > 0) {
      for (const addr of addresses) {
        await tx.customerAddress.create({
          data: {
            customerId:   c.id,
            type:         addr.type,
            label:        addr.label || 'Main',
            addressLine1: addr.addressLine1,
            addressLine2: addr.addressLine2 || null,
            city:         addr.city,
            state:        addr.state,
            postalCode:   addr.postalCode,
            country:      addr.country || 'US',
            isDefault:    addr.isDefault ?? false,
          },
        })
      }
    }

    return tx.wholesaleCustomer.findUnique({
      where: { id: c.id },
      include: { addresses: true },
    })
  })

  return NextResponse.json(customer, { status: 201 })
}
