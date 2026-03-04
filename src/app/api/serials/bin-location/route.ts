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

  const result = await prisma.inventorySerial.updateMany({
    where: { id: { in: serialIds } },
    data: { binLocation: binLocation.trim() || null },
  })

  return NextResponse.json({ updated: result.count })
}
