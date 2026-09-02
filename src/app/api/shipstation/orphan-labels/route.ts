/**
 * GET  /api/shipstation/orphan-labels        — returns the last cached scan (fast)
 * POST /api/shipstation/orphan-labels?days=90 — runs a fresh ShipStation pull + caches it
 *
 * Reconciles ShipStation's purchased labels against our saved OrderLabels to
 * find "orphans": labels ShipStation charged us for that our system never
 * recorded (buy succeeded on ShipStation but our save-label step errored).
 *
 * The ShipStation pull is slow + rate-limited, so it only runs on POST (user
 * triggers "Sync"). GET serves the cached candidate list and re-filters it
 * against currently saved/voided labels, so voiding an orphan or saving a real
 * label reflects immediately without a re-sync.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface Candidate {
  shipmentId: number
  orderNumber: string | null
  trackingNumber: string | null
  carrierCode: string | null
  serviceCode: string | null
  shipmentCost: number | null
  createDate: string
}

const norm = (t: string | null | undefined) => (t ?? '').toUpperCase().replace(/\s+/g, '')

/** Build the response (orphans + totals) from a cached candidate list, filtering
 *  against currently saved/voided labels and annotating refund-requested. */
async function buildResponse(candidates: Candidate[], meta: { scannedAt: Date | null; lookbackDays: number; shipmentsScanned: number; voidedSkipped: number }) {
  // Trackings we already account for:
  //  - saved OrderLabels
  //  - tracking recorded directly on an order (manual ship / synced-back / older
  //    flows create no OrderLabel but do set orders.shipTracking)
  //  - voided labels (order-level void audit + orphan-void audit)
  const [savedLabels, orderTrackings, orderVoids, orphanVoids, refundEvents] = await Promise.all([
    prisma.orderLabel.findMany({ select: { trackingNumber: true } }),
    prisma.order.findMany({ where: { shipTracking: { not: null } }, select: { shipTracking: true } }),
    prisma.auditEvent.findMany({ where: { entityType: 'orderLabel', action: 'label_voided' }, select: { before: true } }),
    prisma.auditEvent.findMany({ where: { entityType: 'orphanLabel', action: 'voided' }, select: { before: true } }),
    prisma.auditEvent.findMany({ where: { entityType: 'orphanLabel', action: 'refund_requested' }, select: { entityId: true } }),
  ])
  const known = new Set<string>()
  for (const l of savedLabels) if (l.trackingNumber) known.add(norm(l.trackingNumber))
  for (const o of orderTrackings) {
    // shipTracking may hold multiple comma/space-separated numbers (multi-box).
    for (const tn of (o.shipTracking ?? '').split(/[,\s]+/)) if (tn) known.add(norm(tn))
  }
  for (const e of [...orderVoids, ...orphanVoids]) {
    const tn = (e.before as { trackingNumber?: string } | null)?.trackingNumber
    if (tn) known.add(norm(tn))
  }
  const refundRequested = new Set(refundEvents.map(e => e.entityId))

  const remaining = candidates.filter(c => c.trackingNumber && !known.has(norm(c.trackingNumber)))

  const orderNumbers = Array.from(new Set(remaining.map(c => c.orderNumber).filter((n): n is string => !!n)))
  const orders = orderNumbers.length > 0
    ? await prisma.order.findMany({
        where: { amazonOrderId: { in: orderNumbers } },
        select: { amazonOrderId: true, olmNumber: true, orderSource: true, workflowStatus: true },
      })
    : []
  const orderByNum = new Map(orders.map(o => [o.amazonOrderId, o]))

  const orphans = remaining.map(c => {
    const o = c.orderNumber ? orderByNum.get(c.orderNumber) : undefined
    return {
      shipmentId: c.shipmentId,
      orderNumber: c.orderNumber,
      olmNumber: o?.olmNumber ?? null,
      orderSource: o?.orderSource ?? null,
      orderWorkflowStatus: o?.workflowStatus ?? null,
      trackingNumber: c.trackingNumber,
      carrier: c.carrierCode,
      service: c.serviceCode,
      cost: c.shipmentCost ?? 0,
      createDate: c.createDate,
      refundRequested: refundRequested.has(String(c.shipmentId)),
    }
  }).sort((a, b) => (b.createDate || '').localeCompare(a.createDate || ''))

  const totalCost = Math.round(orphans.reduce((sum, o) => sum + (o.cost ?? 0), 0) * 100) / 100

  return {
    lastSyncedAt: meta.scannedAt,
    lookbackDays: meta.lookbackDays,
    shipmentsScanned: meta.shipmentsScanned,
    voidedSkipped: meta.voidedSkipped,
    orphanCount: orphans.length,
    totalOrphanCost: totalCost,
    orphans,
  }
}

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scan = await prisma.orphanLabelScan.findFirst({ orderBy: { scannedAt: 'desc' } })
  if (!scan) {
    return NextResponse.json({ lastSyncedAt: null, lookbackDays: 90, shipmentsScanned: 0, voidedSkipped: 0, orphanCount: 0, totalOrphanCost: 0, orphans: [] })
  }
  const candidates = (scan.candidates as unknown as Candidate[]) ?? []
  const body = await buildResponse(candidates, {
    scannedAt: scan.scannedAt, lookbackDays: scan.lookbackDays, shipmentsScanned: scan.shipmentsScanned, voidedSkipped: scan.voidedSkipped,
  })
  return NextResponse.json(body)
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Math.min(365, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') ?? '90', 10) || 90))
  const since = new Date(Date.now() - days * 86_400_000)
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

  const voidedSkipped = shipments.filter(s => s.voided).length
  const candidates: Candidate[] = shipments
    .filter(s => !s.voided && s.trackingNumber)
    .map(s => ({
      shipmentId: s.shipmentId,
      orderNumber: s.orderNumber,
      trackingNumber: s.trackingNumber,
      carrierCode: s.carrierCode,
      serviceCode: s.serviceCode,
      shipmentCost: s.shipmentCost,
      createDate: s.createDate,
    }))

  // Keep a single latest snapshot.
  await prisma.orphanLabelScan.deleteMany({})
  await prisma.orphanLabelScan.create({
    data: { lookbackDays: days, shipmentsScanned: shipments.length, voidedSkipped, candidates: candidates as unknown as object[] },
  })

  const body = await buildResponse(candidates, { scannedAt: new Date(), lookbackDays: days, shipmentsScanned: shipments.length, voidedSkipped })
  return NextResponse.json(body)
}
