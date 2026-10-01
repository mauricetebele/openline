/**
 * POST /api/inventory/unlock-codes
 * Bulk-set an optional device unlock code / passcode per serial. Two phases:
 *   { rows, commit: false } → validate only (no writes), returns per-row status.
 *   { rows, commit: true }  → apply the valid rows.
 *
 * Each row: { serial: string, unlockCode: string }. A serial can be set when it
 * exists (any status — unlock codes stay useful for sold/out-of-stock units); the
 * code must be non-empty.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type RowStatus = 'valid' | 'not_found' | 'empty_code' | 'duplicate'
interface RowResult {
  serial: string
  unlockCode: string | null
  status: RowStatus
  serialId?: string
  sku?: string | null
  model?: string | null
  grade?: string | null
}

const norm = (s: string) => s.trim().toUpperCase()

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const rawRows: unknown[] = Array.isArray(body?.rows) ? body.rows : []
  const commit = body?.commit === true

  // Parse + de-duplicate (first occurrence kept, rest flagged duplicate).
  const seen = new Set<string>()
  const parsed: { serial: string; key: string; unlockCode: string | null; dup: boolean }[] = []
  for (const r of rawRows) {
    const o = (r ?? {}) as Record<string, unknown>
    const serial = typeof o.serial === 'string' ? o.serial.trim() : ''
    if (!serial) continue
    const codeRaw = typeof o.unlockCode === 'string' ? o.unlockCode.trim() : ''
    const key = norm(serial)
    const dup = seen.has(key)
    if (!dup) seen.add(key)
    parsed.push({ serial, key, unlockCode: codeRaw || null, dup })
  }
  if (parsed.length === 0) return NextResponse.json({ error: 'No rows provided' }, { status: 400 })

  // Look up all serials in one query.
  const serials = await prisma.inventorySerial.findMany({
    where: { serialNumber: { in: parsed.map(p => p.serial) } },
    select: {
      id: true, serialNumber: true, status: true,
      product: { select: { sku: true, description: true } },
      grade: { select: { grade: true } },
    },
  })
  const bySerial = new Map(serials.map(s => [norm(s.serialNumber), s]))

  const results: RowResult[] = parsed.map(p => {
    const rec = bySerial.get(p.key)
    let status: RowStatus
    if (p.dup) status = 'duplicate'
    else if (!rec) status = 'not_found'
    else if (!p.unlockCode) status = 'empty_code'
    else status = 'valid'
    return {
      serial: p.serial,
      unlockCode: p.unlockCode,
      status,
      serialId: rec?.id,
      sku: rec?.product?.sku ?? null,
      model: rec?.product?.description ?? null,
      grade: rec?.grade?.grade ?? null,
    }
  })

  const validRows = results.filter(r => r.status === 'valid')
  const counts = {
    total: parsed.length,
    valid: validRows.length,
    not_found: results.filter(r => r.status === 'not_found').length,
    empty_code: results.filter(r => r.status === 'empty_code').length,
    duplicate: results.filter(r => r.status === 'duplicate').length,
  }

  if (!commit) return NextResponse.json({ staged: true, counts, results })

  if (validRows.length === 0) return NextResponse.json({ error: 'No valid rows to apply', counts, results }, { status: 400 })
  // Apply each valid row.
  await prisma.$transaction(
    validRows.map(r => prisma.inventorySerial.update({
      where: { id: r.serialId! },
      data: { unlockCode: r.unlockCode! },
    })),
  )

  return NextResponse.json({ committed: true, applied: validRows.length, counts, results })
}
