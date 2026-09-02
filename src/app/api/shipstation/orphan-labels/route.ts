/**
 * GET /api/shipstation/orphan-labels?days=90
 *
 * Reconciles ShipStation's purchased labels against our saved OrderLabels to
 * find "orphans": labels ShipStation charged us for that our system never
 * recorded (e.g. the buy succeeded on ShipStation but our save-label step
 * errored, leaving the order stuck without a label). These are candidates to
 * void + request a refund on.
 *
 * A ShipStation shipment is an orphan when:
 *   - it is NOT voided (voided labels are already refunded), AND
 *   - its tracking number is not saved on any OrderLabel, AND
 *   - its tracking number is not in our voided-label audit log.
 *
 * Query: days (lookback window, default 90, max 365)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Math.min(365, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') ?? '90', 10) || 90))
  const since = new Date(Date.now() - days * 86_400_000)
  // ShipStation V1 expects local-ish datetime strings; ISO works fine here.
  const createDateStart = since.toISOString().slice(0, 19).replace('T', ' ')

  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
  })
  if (!account) return NextResponse.json({ error: 'No active ShipStation account connected' }, { status: 404 })

  const client = new ShipStationClient(
    decrypt(account.apiKeyEnc),
    account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '',
    account.v2ApiKeyEnc ? decrypt(account.v2ApiKeyEnc) : null,
  )

  let shipments
  try {
    shipments = await client.listShipments({ createDateStart })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to list ShipStation shipments: ${msg}` }, { status: 502 })
  }

  // Normalize a tracking number for comparison (uppercase, no spaces).
  const norm = (t: string | null | undefined) => (t ?? '').toUpperCase().replace(/\s+/g, '')

  // Our known tracking numbers: saved OrderLabels + previously-voided labels (audit).
  const [savedLabels, voidedEvents] = await Promise.all([
    prisma.orderLabel.findMany({ select: { trackingNumber: true } }),
    prisma.auditEvent.findMany({
      where: { entityType: 'orderLabel', action: 'label_voided' },
      select: { before: true },
    }),
  ])
  const known = new Set<string>()
  for (const l of savedLabels) if (l.trackingNumber) known.add(norm(l.trackingNumber))
  for (const e of voidedEvents) {
    const tn = (e.before as { trackingNumber?: string } | null)?.trackingNumber
    if (tn) known.add(norm(tn))
  }

  // Candidate orphans: non-voided SS shipments whose tracking we never saved.
  const candidates = shipments.filter(s => !s.voided && s.trackingNumber && !known.has(norm(s.trackingNumber)))

  // Enrich with our order (by orderNumber = amazonOrderId) for context.
  const orderNumbers = Array.from(new Set(candidates.map(c => c.orderNumber).filter((n): n is string => !!n)))
  const orders = orderNumbers.length > 0
    ? await prisma.order.findMany({
        where: { amazonOrderId: { in: orderNumbers } },
        select: { amazonOrderId: true, olmNumber: true, orderSource: true, workflowStatus: true },
      })
    : []
  const orderByNum = new Map(orders.map(o => [o.amazonOrderId, o]))

  const orphans = candidates.map(s => {
    const o = s.orderNumber ? orderByNum.get(s.orderNumber) : undefined
    return {
      shipmentId: s.shipmentId,
      orderNumber: s.orderNumber,
      olmNumber: o?.olmNumber ?? null,
      orderSource: o?.orderSource ?? null,
      orderWorkflowStatus: o?.workflowStatus ?? null,
      trackingNumber: s.trackingNumber,
      carrier: s.carrierCode,
      service: s.serviceCode,
      cost: s.shipmentCost ?? 0,
      createDate: s.createDate,
    }
  }).sort((a, b) => (b.createDate || '').localeCompare(a.createDate || ''))

  const totalCost = Math.round(orphans.reduce((sum, o) => sum + (o.cost ?? 0), 0) * 100) / 100

  return NextResponse.json({
    lookbackDays: days,
    shipmentsScanned: shipments.length,
    voidedSkipped: shipments.filter(s => s.voided).length,
    orphanCount: orphans.length,
    totalOrphanCost: totalCost,
    orphans,
  })
}
