/**
 * POST /api/inventory/battery-health/scan-log
 *   Record one physical scan from the BH Sorting Tool.
 *   Body: { serial, batteryHealthPct?, verdict, threshold?, sku?, model?, grade? }
 *
 * GET /api/inventory/battery-health/scan-log?serial=&limit=
 *   Recent scan history (optionally filtered to one serial), newest first.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const serial = typeof b?.serial === 'string' ? b.serial.trim() : ''
  if (!serial) return NextResponse.json({ error: 'serial is required' }, { status: 400 })
  const verdict = typeof b?.verdict === 'string' ? b.verdict : 'unknown'
  const bh = b?.batteryHealthPct == null || b.batteryHealthPct === '' ? null : Number(b.batteryHealthPct)
  const threshold = b?.threshold == null ? null : Number(b.threshold)

  const event = await prisma.bhScanEvent.create({
    data: {
      serialNumber: serial,
      batteryHealthPct: Number.isFinite(bh as number) ? (bh as number) : null,
      verdict,
      threshold: Number.isFinite(threshold as number) ? Math.round(threshold as number) : null,
      sku: typeof b?.sku === 'string' ? b.sku : null,
      model: typeof b?.model === 'string' ? b.model : null,
      grade: typeof b?.grade === 'string' ? b.grade : null,
      scannedById: user.dbId,
      scannedByEmail: user.email,
    },
  })
  return NextResponse.json({ ok: true, id: event.id })
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serial = req.nextUrl.searchParams.get('serial')?.trim()
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '200', 10) || 200, 500)

  const events = await prisma.bhScanEvent.findMany({
    where: serial ? { serialNumber: { equals: serial, mode: 'insensitive' } } : {},
    orderBy: { scannedAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ events })
}
