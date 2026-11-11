/**
 * POST /api/fedex-bill-audit/match
 * Body: { trackingNumbers: string[] }
 *
 * For each tracking number on an uploaded FedEx bill, returns the quoted label
 * cost + order context for the label we purchased through the system (if any),
 * so the client can compare FedEx's billed Net Charge against what we were
 * quoted. Matches against OrderLabel (outbound order labels) and ReturnLabel
 * (return / wholesale / vendor-RMA / repair labels) by tracking number.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export interface FedexLabelMatch {
  trackingNumber: string
  source: 'order' | 'return'
  quoted: number | null
  serviceCode: string | null
  serviceLabel: string | null
  purchasedAt: string
  // context
  orderId?: string | null
  olmNumber?: number | null
  amazonOrderId?: string | null
  salesOrderId?: string | null
}

// FedEx tracking numbers are numeric; our stored values may carry surrounding
// quotes/whitespace. Normalize both sides the same way, and also match on a
// leading-zero-stripped form (bills sometimes drop or add a leading zero).
const norm = (s: string) => s.replace(/^["'\s]+|["'\s]+$/g, '').toUpperCase()
const stripZeros = (s: string) => s.replace(/^0+/, '')

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const raw = Array.isArray(body?.trackingNumbers) ? (body.trackingNumbers as unknown[]) : null
  if (!raw) return NextResponse.json({ error: 'trackingNumbers[] is required' }, { status: 400 })

  const tracking = Array.from(new Set(raw.map(t => norm(String(t))).filter(Boolean)))
  if (tracking.length === 0) return NextResponse.json({ matches: {} })

  // Query a superset (exact + zero-stripped) so leading-zero drift still matches.
  const queryValues = Array.from(new Set([...tracking, ...tracking.map(stripZeros)]))

  const [orderLabels, returnLabels] = await Promise.all([
    prisma.orderLabel.findMany({
      where: { trackingNumber: { in: queryValues } },
      select: {
        trackingNumber: true, shipmentCost: true, serviceCode: true, createdAt: true,
        order: { select: { id: true, olmNumber: true, amazonOrderId: true } },
      },
    }),
    prisma.returnLabel.findMany({
      where: { trackingNumber: { in: queryValues }, voided: false },
      select: {
        trackingNumber: true, shipmentCost: true, serviceCode: true, serviceLabel: true,
        amazonOrderId: true, salesOrderId: true, createdAt: true,
      },
    }),
  ])

  // Keyed by both the exact and zero-stripped tracking so the client can hit
  // either. Order labels win over return labels when both exist.
  const matches: Record<string, FedexLabelMatch> = {}
  const put = (key: string, m: FedexLabelMatch) => {
    matches[key] = m
    const z = stripZeros(key)
    if (z && z !== key && !matches[z]) matches[z] = m
  }

  for (const l of returnLabels) {
    put(norm(l.trackingNumber), {
      trackingNumber: norm(l.trackingNumber),
      source: 'return',
      quoted: l.shipmentCost != null ? Number(l.shipmentCost) : null,
      serviceCode: l.serviceCode ?? null,
      serviceLabel: l.serviceLabel ?? null,
      purchasedAt: l.createdAt.toISOString(),
      amazonOrderId: l.amazonOrderId ?? null,
      salesOrderId: l.salesOrderId ?? null,
    })
  }
  for (const l of orderLabels) {
    put(norm(l.trackingNumber), {
      trackingNumber: norm(l.trackingNumber),
      source: 'order',
      quoted: l.shipmentCost != null ? Number(l.shipmentCost) : null,
      serviceCode: l.serviceCode ?? null,
      serviceLabel: null,
      purchasedAt: l.createdAt.toISOString(),
      orderId: l.order?.id ?? null,
      olmNumber: l.order?.olmNumber ?? null,
      amazonOrderId: l.order?.amazonOrderId ?? null,
    })
  }

  return NextResponse.json({ matches })
}
