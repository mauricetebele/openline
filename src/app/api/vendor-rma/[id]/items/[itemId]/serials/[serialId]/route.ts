import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; itemId: string; serialId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.vendorRMASerial.delete({ where: { id: params.serialId } })

  // Update item quantity to match remaining serial count
  const count = await prisma.vendorRMASerial.count({ where: { rmaItemId: params.itemId } })
  await prisma.vendorRMAItem.update({ where: { id: params.itemId }, data: { quantity: count } })

  return NextResponse.json({ ok: true })
}
