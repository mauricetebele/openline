import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; addressId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { type, label, addressLine1, addressLine2, city, state, postalCode, country, isDefault } = body

  const address = await prisma.$transaction(async (tx) => {
    if (isDefault && type) {
      await tx.customerAddress.updateMany({
        where: {
          customerId: params.id,
          type,
          isDefault: true,
          id: { not: params.addressId },
        },
        data: { isDefault: false },
      })
    }
    return tx.customerAddress.update({
      where: { id: params.addressId },
      data: {
        ...(type         !== undefined && { type }),
        ...(label        !== undefined && { label }),
        ...(addressLine1 !== undefined && { addressLine1 }),
        ...(addressLine2 !== undefined && { addressLine2: addressLine2 || null }),
        ...(city         !== undefined && { city }),
        ...(state        !== undefined && { state }),
        ...(postalCode   !== undefined && { postalCode }),
        ...(country      !== undefined && { country }),
        ...(isDefault    !== undefined && { isDefault }),
      },
    })
  })

  return NextResponse.json(address)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; addressId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.customerAddress.delete({ where: { id: params.addressId } })
  return NextResponse.json({ ok: true })
}
