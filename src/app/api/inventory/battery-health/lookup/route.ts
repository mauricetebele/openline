/**
 * GET /api/inventory/battery-health/lookup?serial=xxx
 * Fast single-serial lookup for the BH Sorting Tool scan flow. Returns the model
 * info + battery health so the UI can flash green/red against a threshold.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serial = req.nextUrl.searchParams.get('serial')?.trim()
  if (!serial) return NextResponse.json({ error: 'serial is required' }, { status: 400 })

  const s = await prisma.inventorySerial.findFirst({
    where: { serialNumber: { equals: serial, mode: 'insensitive' } },
    select: {
      serialNumber: true, status: true, batteryHealthPct: true,
      product: { select: { sku: true, description: true } },
      grade: { select: { grade: true } },
      location: { select: { name: true } },
    },
  })
  if (!s) return NextResponse.json({ found: false, serial })

  return NextResponse.json({
    found: true,
    serialNumber: s.serialNumber,
    status: s.status,
    batteryHealthPct: s.batteryHealthPct,
    sku: s.product?.sku ?? null,
    model: s.product?.description ?? null,
    grade: s.grade?.grade ?? null,
    location: s.location?.name ?? null,
  })
}
