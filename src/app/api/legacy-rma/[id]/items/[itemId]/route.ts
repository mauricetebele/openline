import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

type Ctx = { params: { id: string; itemId: string } }

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const item = await prisma.legacyRMAItem.findUnique({
    where: { id: params.itemId },
    include: { serials: true },
  })

  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (item.rmaId !== params.id) return NextResponse.json({ error: 'Item does not belong to this RMA' }, { status: 400 })

  if (item.serials.length > 0) {
    return NextResponse.json({ error: 'Cannot delete — serials have been received for this item' }, { status: 400 })
  }

  await prisma.legacyRMAItem.delete({ where: { id: params.itemId } })
  return NextResponse.json({ ok: true })
}
