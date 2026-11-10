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

// Postgres jsonb rejects the NUL character inside strings; real Apple lockdown /
// ioreg blobs can contain them (binary-ish values). Deep-strip NUL before storing.
const NUL = new RegExp(String.fromCharCode(0), 'g')
function sanitizeJson(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(NUL, '')
  if (Array.isArray(v)) return v.map(sanitizeJson)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k.replace(NUL, '')] = sanitizeJson(val)
    return out
  }
  return v
}

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

  let enriched
  try {
    enriched = enrichAppleScan(raw)
  } catch (e) {
    console.error('[agent-scan] enrich failed:', e)
    return NextResponse.json({ error: `Enrich failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
  if (!enriched.serialNumber && !enriched.udid && !enriched.imei) {
    return NextResponse.json(
      { error: 'No identifiable device data in scan — is a device connected, unlocked, and trusted?' },
      { status: 422 },
    )
  }

  try {
    const diagnostic = await prisma.deviceDiagnostic.create({
      data: {
        ...enriched,
        rawLockdown: sanitizeJson(raw.lockdown ?? undefined) as Prisma.InputJsonValue | undefined,
        rawBattery: sanitizeJson(raw.ioregBattery ?? undefined) as Prisma.InputJsonValue | undefined,
        scannedByUserId: tokenRow.userId,
      },
    })
    await prisma.deviceAgentToken.update({ where: { id: tokenRow.id }, data: { lastSeenAt: new Date() } }).catch(() => {})
    return NextResponse.json({ diagnostic })
  } catch (e) {
    console.error('[agent-scan] store failed:', e)
    return NextResponse.json({ error: `Store failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
