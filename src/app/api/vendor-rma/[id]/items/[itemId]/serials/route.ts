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

  // Check if serial exists on an active vendor RMA (not yet scanned out).
  // Serials that were shipped on a previous VRMA and then re-received on a new PO
  // are allowed to be added to a new VRMA.
  const existingOnAnyRma = await prisma.vendorRMASerial.findFirst({
    where: { serialNumber: serialNumber.trim(), scannedOutAt: null },
    include: { rmaItem: { include: { rma: { select: { rmaNumber: true } } } } },
  })
  if (existingOnAnyRma) {
    const vrmaNum = existingOnAnyRma.rmaItem.rma.rmaNumber
    return NextResponse.json({ error: `Serial "${serialNumber.trim()}" is already on ${vrmaNum}` }, { status: 409 })
  }

  const serial = await prisma.vendorRMASerial.create({
    data: { rmaItemId: params.itemId, serialNumber: serialNumber.trim() },
  })

  // Update item quantity to match serial count
  const count = await prisma.vendorRMASerial.count({ where: { rmaItemId: params.itemId } })
  await prisma.vendorRMAItem.update({ where: { id: params.itemId }, data: { quantity: count } })

  return NextResponse.json(serial, { status: 201 })
}
