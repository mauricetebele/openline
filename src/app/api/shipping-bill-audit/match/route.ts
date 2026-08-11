/**
 * POST /api/shipping-bill-audit/match
 * Body: { trackingNumbers: string[] }
 * Returns the quoted label cost + order context for each tracking number that
 * was purchased through the system, so the client can compare billed vs quoted.
 * Matches against OrderLabel (outbound order labels) first, then ReturnLabel.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export interface LabelMatch {
  trackingNumber: string
  source: 'order' | 'return'
  quoted: number | null
  carrier: string | null
  serviceCode: string | null
  purchasedAt: string
  // context
  orderId?: string
  olmNumber?: number | null
  amazonOrderId?: string | null
  orderSource?: string | null
  shipToState?: string | null
  shipToPostal?: string | null
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const raw = Array.isArray(body?.trackingNumbers) ? (body.trackingNumbers as unknown[]) : null
  if (!raw) return NextResponse.json({ error: 'trackingNumbers[] is required' }, { status: 400 })

  // Normalize + dedupe (strip surrounding quotes/whitespace, uppercase).
  const norm = (s: string) => s.replace(/^["'\s]+|["'\s]+$/g, '').toUpperCase()
  const tracking = Array.from(new Set(raw.map(t => norm(String(t))).filter(Boolean)))
  if (tracking.length === 0) return NextResponse.json({ matches: {} })

  const [orderLabels, returnLabels] = await Promise.all([
    prisma.orderLabel.findMany({
      where: { trackingNumber: { in: tracking } },
      select: {
        trackingNumber: true, shipmentCost: true, carrier: true, serviceCode: true, createdAt: true,
        order: { select: { id: true, olmNumber: true, amazonOrderId: true, orderSource: true, shipToState: true, shipToPostal: true } },
      },
    }),
    prisma.returnLabel.findMany({
      where: { trackingNumber: { in: tracking }, voided: false },
      select: { trackingNumber: true, shipmentCost: true, serviceCode: true, serviceLabel: true, amazonOrderId: true, createdAt: true },
    }),
  ])

  // Keyed by normalized tracking number. Order labels win over return labels.
  const matches: Record<string, LabelMatch> = {}

  for (const l of returnLabels) {
    const key = norm(l.trackingNumber)
    matches[key] = {
      trackingNumber: key,
      source: 'return',
      quoted: l.shipmentCost != null ? Number(l.shipmentCost) : null,
      carrier: 'ups',
      serviceCode: l.serviceCode ?? l.serviceLabel ?? null,
      purchasedAt: l.createdAt.toISOString(),
      amazonOrderId: l.amazonOrderId ?? null,
    }
  }
  for (const l of orderLabels) {
    const key = norm(l.trackingNumber)
    matches[key] = {
      trackingNumber: key,
      source: 'order',
      quoted: l.shipmentCost != null ? Number(l.shipmentCost) : null,
      carrier: l.carrier ?? null,
      serviceCode: l.serviceCode ?? null,
      purchasedAt: l.createdAt.toISOString(),
      orderId: l.order.id,
      olmNumber: l.order.olmNumber,
      amazonOrderId: l.order.amazonOrderId,
      orderSource: l.order.orderSource,
      shipToState: l.order.shipToState,
      shipToPostal: l.order.shipToPostal,
    }
  }

  return NextResponse.json({ matches })
}
