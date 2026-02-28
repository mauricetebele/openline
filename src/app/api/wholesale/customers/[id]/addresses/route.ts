import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const addresses = await prisma.customerAddress.findMany({
    where: { customerId: params.id },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ data: addresses })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { type, label, addressLine1, addressLine2, city, state, postalCode, country, isDefault } = body

  if (!type || !addressLine1 || !city || !state || !postalCode) {
    return NextResponse.json({ error: 'type, addressLine1, city, state, postalCode are required' }, { status: 400 })
  }

  const address = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.customerAddress.updateMany({
        where: { customerId: params.id, type, isDefault: true },
        data:  { isDefault: false },
      })
    }
    return tx.customerAddress.create({
      data: {
        customerId:   params.id,
        type,
        label:        label || 'Main',
        addressLine1,
        addressLine2: addressLine2 || null,
        city,
        state,
        postalCode,
        country:      country || 'US',
        isDefault:    isDefault ?? false,
      },
    })
  })

  return NextResponse.json(address, { status: 201 })
}
