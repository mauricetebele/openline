import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { serialNumber } = await req.json()
  if (!serialNumber?.trim()) {
    return NextResponse.json({ error: 'Serial number is required' }, { status: 400 })
  }

  const existing = await prisma.vendorRMASerial.findUnique({
    where: { rmaItemId_serialNumber: { rmaItemId: params.itemId, serialNumber: serialNumber.trim() } },
  })
  if (existing) {
    return NextResponse.json({ error: 'Serial already added to this item' }, { status: 409 })
  }

  const serial = await prisma.vendorRMASerial.create({
    data: { rmaItemId: params.itemId, serialNumber: serialNumber.trim() },
  })

  // Update item quantity to match serial count
  const count = await prisma.vendorRMASerial.count({ where: { rmaItemId: params.itemId } })
  await prisma.vendorRMAItem.update({ where: { id: params.itemId }, data: { quantity: count } })

  return NextResponse.json(serial, { status: 201 })
}
