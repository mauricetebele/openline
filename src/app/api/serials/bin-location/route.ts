import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { serialIds, binLocation } = body as { serialIds: string[]; binLocation: string }

  if (!Array.isArray(serialIds) || serialIds.length === 0) {
    return NextResponse.json({ error: 'serialIds is required' }, { status: 400 })
  }
  if (typeof binLocation !== 'string') {
    return NextResponse.json({ error: 'binLocation is required' }, { status: 400 })
  }

  const trimmed = binLocation.trim() || null

  await prisma.$transaction(async tx => {
    const serials = await tx.inventorySerial.findMany({
      where: { id: { in: serialIds } },
      select: { id: true, locationId: true, binLocation: true },
    })

    for (const s of serials) {
      if (s.binLocation === trimmed) continue

      await tx.inventorySerial.update({
        where: { id: s.id },
        data: { binLocation: trimmed },
      })

      await tx.serialHistory.create({
        data: {
          inventorySerialId: s.id,
          eventType: 'BIN_ASSIGNED',
          locationId: s.locationId,
          notes: trimmed ? `Bin location set to "${trimmed}"` : 'Bin location cleared',
        },
      })
    }
  })

  return NextResponse.json({ updated: serialIds.length })
}
