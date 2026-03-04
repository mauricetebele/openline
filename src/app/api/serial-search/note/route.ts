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

  const trimmed = note?.trim() || null

  const updated = await prisma.$transaction(async tx => {
    const serial = await tx.inventorySerial.update({
      where: { id },
      data: { note: trimmed },
      select: { id: true, note: true, locationId: true },
    })

    if (trimmed) {
      await tx.serialHistory.create({
        data: {
          inventorySerialId: id,
          eventType: 'NOTE_ADDED',
          locationId: serial.locationId,
          notes: trimmed,
        },
      })
    }

    return { id: serial.id, note: serial.note }
  })

  return NextResponse.json(updated)
}
