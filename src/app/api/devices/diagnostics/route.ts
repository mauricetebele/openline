/**
 * GET /api/devices/diagnostics?limit=50&q=<serial|imei|model>
 * Recent device diagnostic scans (raw blobs excluded to keep the payload light).
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const q = searchParams.get('q')?.trim()

  const where: Prisma.DeviceDiagnosticWhereInput = q
    ? {
        OR: [
          { serialNumber: { contains: q, mode: 'insensitive' } },
          { imei: { contains: q, mode: 'insensitive' } },
          { imei2: { contains: q, mode: 'insensitive' } },
          { marketingName: { contains: q, mode: 'insensitive' } },
          { udid: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {}

  const diagnostics = await prisma.deviceDiagnostic.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, udid: true, deviceClass: true, serialNumber: true,
      imei: true, imei2: true, productType: true, marketingName: true,
      modelNumber: true, regionCode: true, regionName: true, iosVersion: true,
      batteryHealthPct: true, batteryCycleCount: true, batteryCurrentCharge: true,
      activationState: true, agentVersion: true, createdAt: true,
    },
  })

  return NextResponse.json({ diagnostics })
}
