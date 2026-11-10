/**
 * POST /api/devices/agent-scan
 * Token-authenticated ingest for the desktop device agent (Authorization: Bearer
 * <agent token>). Enriches the RawAppleScan and stores a DeviceDiagnostic,
 * attributed to the token's owner. Mirrors /api/devices/diagnostic-scan but uses
 * an agent token instead of a browser session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { enrichAppleScan, type RawAppleScan } from '@/lib/devices/apple-enrich'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return NextResponse.json({ error: 'Missing agent token' }, { status: 401 })

  const tokenRow = await prisma.deviceAgentToken.findUnique({ where: { token } })
  if (!tokenRow) return NextResponse.json({ error: 'Invalid agent token' }, { status: 401 })

  let raw: RawAppleScan
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const enriched = enrichAppleScan(raw)
  if (!enriched.serialNumber && !enriched.udid && !enriched.imei) {
    return NextResponse.json(
      { error: 'No identifiable device data in scan — is a device connected, unlocked, and trusted?' },
      { status: 422 },
    )
  }

  const [diagnostic] = await Promise.all([
    prisma.deviceDiagnostic.create({
      data: {
        ...enriched,
        rawLockdown: (raw.lockdown ?? undefined) as Prisma.InputJsonValue | undefined,
        rawBattery: (raw.ioregBattery ?? undefined) as Prisma.InputJsonValue | undefined,
        scannedByUserId: tokenRow.userId,
      },
    }),
    prisma.deviceAgentToken.update({ where: { id: tokenRow.id }, data: { lastSeenAt: new Date() } }),
  ])

  return NextResponse.json({ diagnostic })
}
