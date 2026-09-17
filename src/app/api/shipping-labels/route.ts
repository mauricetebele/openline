/**
 * POST /api/shipping-labels  — create a manual multi-piece shipping label
 * GET  /api/shipping-labels  — history of labels created with this tool
 *
 * Labels are stored in ReturnLabel with labelType MANUAL_UPS | MANUAL_FEDEX |
 * MANUAL_SS (one row per piece). Their tracking numbers feed orphan
 * reconciliation, so they are never flagged as orphaned ShipStation labels.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { parseManualLabelInput, createManualShipment } from '@/lib/shipping-labels'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MANUAL_TYPES = ['MANUAL_UPS', 'MANUAL_FEDEX', 'MANUAL_SS']

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  try {
    const input = parseManualLabelInput(body)
    const result = await createManualShipment(input)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Label creation failed' }, { status: 400 })
  }
}

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const labels = await prisma.returnLabel.findMany({
    where: { labelType: { in: MANUAL_TYPES } },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true, labelType: true, shipFromName: true, shipFromAddress1: true, shipFromCity: true,
      shipFromState: true, shipFromPostal: true, serviceCode: true, serviceLabel: true,
      weightValue: true, weightUnit: true, trackingNumber: true, shipmentId: true,
      shipmentCost: true, currency: true, voided: true, voidedAt: true, createdAt: true,
      upsCredential: { select: { nickname: true } },
    },
  })

  return NextResponse.json(labels)
}
