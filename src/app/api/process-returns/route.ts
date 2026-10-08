/**
 * GET  /api/process-returns  — list staged returns (newest first)
 * POST /api/process-returns  — create a staged return
 *
 * PROCESS RETURNS is a warehouse staging log so the RMA processor can log
 * received returns and communicate with the administrator. It is purely
 * informational: it NEVER touches inventory serials, quantities, or movement.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const returns = await prisma.processReturn.findMany({
    // Unfinished drafts (completed=false) surface first so they're easy to resume.
    orderBy: [{ completed: 'asc' }, { flagged: 'desc' }, { createdAt: 'desc' }],
    include: { units: { orderBy: { createdAt: 'asc' } } },
  })

  const matchByReturnId = await computeSerialMatches(returns)
  const data = returns.map(r => ({ ...r, match: matchByReturnId.get(r.id) ?? { eligible: false, matched: false } }))
  return NextResponse.json({ data })
}

interface MatchResult { eligible: boolean; matched: boolean }

/**
 * For "Not Yet Processed" Amazon returns: if the tracking number belongs to an
 * MFN return whose order has a single unit, flag whether the serial(s) the
 * processor entered match the serial that was sold on that order. Case-insensitive.
 */
async function computeSerialMatches(
  returns: { id: string; archived: boolean; trackingNumber: string; units: { serialNumber: string }[] }[],
): Promise<Map<string, MatchResult>> {
  const out = new Map<string, MatchResult>()
  // Only relevant for the "Not Yet Processed" tab (active, non-archived).
  const active = returns.filter(r => !r.archived && r.trackingNumber?.trim())
  if (active.length === 0) return out

  try {
    const trackings = Array.from(new Set(active.map(r => r.trackingNumber.trim())))
    const mfnRows = await prisma.mFNReturn.findMany({
      where: { OR: trackings.map(t => ({ trackingNumber: { equals: t, mode: 'insensitive' as const } })) },
      select: { trackingNumber: true, orderId: true, orderQuantity: true },
    })
    // tracking (upper) → MFN return (first match wins)
    const mfnByTrack = new Map<string, { orderId: string; orderQuantity: number | null }>()
    for (const m of mfnRows) {
      if (!m.trackingNumber) continue
      const key = m.trackingNumber.trim().toUpperCase()
      if (!mfnByTrack.has(key)) mfnByTrack.set(key, { orderId: m.orderId, orderQuantity: m.orderQuantity })
    }
    if (mfnByTrack.size === 0) return out

    // Resolve each matched order: total quantity + the serial(s) sold on it.
    const orderIds = Array.from(new Set(mfnRows.map(m => m.orderId)))
    const orders = await prisma.order.findMany({
      where: { amazonOrderId: { in: orderIds }, orderSource: 'amazon' },
      select: {
        id: true, amazonOrderId: true,
        items: {
          select: {
            quantityOrdered: true,
            serialAssignments: { select: { inventorySerial: { select: { serialNumber: true } } } },
          },
        },
      },
    })
    // Fallback serials via SALE history for orders whose assignments were cleared.
    const internalOrderIds = orders.map(o => o.id)
    const saleRows = internalOrderIds.length
      ? await prisma.serialHistory.findMany({
          where: { orderId: { in: internalOrderIds }, eventType: 'SALE' },
          select: { orderId: true, inventorySerial: { select: { serialNumber: true } } },
        })
      : []
    const saleByInternalId = new Map<string, Set<string>>()
    for (const s of saleRows) {
      const sn = s.inventorySerial?.serialNumber?.trim().toUpperCase()
      if (!s.orderId || !sn) continue
      if (!saleByInternalId.has(s.orderId)) saleByInternalId.set(s.orderId, new Set())
      saleByInternalId.get(s.orderId)!.add(sn)
    }

    // amazonOrderId → { totalQty, serials }
    const orderInfo = new Map<string, { totalQty: number; serials: Set<string> }>()
    for (const o of orders) {
      const totalQty = o.items.reduce((sum, it) => sum + (it.quantityOrdered ?? 0), 0)
      const serials = new Set<string>()
      for (const it of o.items) {
        for (const a of it.serialAssignments) {
          const sn = a.inventorySerial?.serialNumber?.trim().toUpperCase()
          if (sn) serials.add(sn)
        }
      }
      Array.from(saleByInternalId.get(o.id) ?? []).forEach(sn => serials.add(sn))
      orderInfo.set(o.amazonOrderId, { totalQty, serials })
    }

    for (const r of active) {
      const mfn = mfnByTrack.get(r.trackingNumber.trim().toUpperCase())
      if (!mfn) continue // not an Amazon MFN return → not eligible
      const info = orderInfo.get(mfn.orderId)
      const totalQty = info?.totalQty ?? mfn.orderQuantity ?? null
      // Eligible only for a single-unit Amazon order we can resolve.
      if (!info || totalQty !== 1) { out.set(r.id, { eligible: false, matched: false }); continue }
      const entered = r.units.map(u => u.serialNumber?.trim().toUpperCase()).filter(Boolean)
      const matched = entered.some(sn => info.serials.has(sn))
      out.set(r.id, { eligible: true, matched })
    }
  } catch (err) {
    console.error('[process-returns] serial match computation failed:', err instanceof Error ? err.message : err)
  }
  return out
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const trackingNumber = String(body?.trackingNumber ?? '').trim()
  const carrier = String(body?.carrier ?? '').trim()
  const note = typeof body?.note === 'string' ? body.note.trim() || null : null
  const rawUnits: unknown[] = Array.isArray(body?.units) ? body.units : []
  // "Resume Later" saves an unfinished record: relaxed validation, marked Not Yet Completed.
  const completed = body?.completed !== false

  const units = rawUnits
    .map(u => {
      const uu = u as { serialNumber?: unknown; grade?: unknown }
      return {
        serialNumber: String(uu.serialNumber ?? '').trim(),
        grade: uu.grade != null && String(uu.grade).trim() ? String(uu.grade).trim() : null,
      }
    })
    .filter(u => u.serialNumber)

  // A finalized submit requires the full record; a draft can be saved with whatever's present.
  if (completed) {
    if (!trackingNumber) return NextResponse.json({ error: 'Tracking number is required' }, { status: 400 })
    if (!carrier) return NextResponse.json({ error: 'Carrier is required' }, { status: 400 })
    if (units.length === 0) return NextResponse.json({ error: 'At least one unit with a serial number is required' }, { status: 400 })
  }

  // Snapshot whether each serial currently exists + its SKU (read-only lookup).
  const serialNumbers = Array.from(new Set(units.map(u => u.serialNumber)))
  const existing = serialNumbers.length
    ? await prisma.inventorySerial.findMany({
        // Case-insensitive so a processor's casing doesn't break the match.
        where: { OR: serialNumbers.map(sn => ({ serialNumber: { equals: sn, mode: 'insensitive' as const } })) },
        select: { serialNumber: true, product: { select: { sku: true } } },
      })
    : []
  const bySerial = new Map(existing.map(s => [s.serialNumber.toUpperCase(), s.product?.sku ?? null]))

  const created = await prisma.processReturn.create({
    data: {
      trackingNumber,
      carrier,
      note,
      completed,
      createdByLabel: user.name || user.email,
      units: {
        create: units.map(u => {
          const hit = bySerial.has(u.serialNumber.toUpperCase())
          return {
            serialNumber: u.serialNumber,
            grade: u.grade,
            serialExists: hit,
            sku: hit ? bySerial.get(u.serialNumber.toUpperCase()) ?? null : null,
          }
        }),
      },
    },
    include: { units: { orderBy: { createdAt: 'asc' } } },
  })

  return NextResponse.json({ data: created }, { status: 201 })
}
