/**
 * POST /api/devices/diagnostic-scan
 *
 * Receives a RAW Apple device scan from the local Windows agent (proxied through
 * the operator's browser), enriches it server-side (marketing name, region,
 * battery health), and persists a DeviceDiagnostic. Raw payloads are stored so
 * enrichment can be reprocessed later without re-scanning.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { enrichAppleScan, type RawAppleScan } from '@/lib/devices/apple-enrich'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let raw: RawAppleScan
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const enriched = enrichAppleScan(raw)

  // Guard against empty/garbage payloads (e.g. no device was connected)
  if (!enriched.serialNumber && !enriched.udid && !enriched.imei) {
    return NextResponse.json(
      { error: 'No identifiable device data in scan — is a device connected, unlocked, and trusted?' },
      { status: 422 },
    )
  }

  const diagnostic = await prisma.deviceDiagnostic.create({
    data: {
      ...enriched,
      rawLockdown: (raw.lockdown ?? undefined) as Prisma.InputJsonValue | undefined,
      rawBattery: (raw.ioregBattery ?? undefined) as Prisma.InputJsonValue | undefined,
      scannedByUserId: user.dbId,
    },
  })

  return NextResponse.json({ diagnostic })
}
