/**
 * PATCH /api/serial-search/note
 * Body: { id: string, note: string }
 * Updates the note field on an InventorySerial record.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, note } = await req.json() as { id?: string; note?: string }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updated = await prisma.inventorySerial.update({
    where: { id },
    data: { note: note?.trim() || null },
    select: { id: true, note: true },
  })

  return NextResponse.json(updated)
}
