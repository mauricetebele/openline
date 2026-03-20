/**
 * GET /api/outbound-label/history
 * Returns past outbound label purchases (newest first), without labelData.
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const labels = await prisma.returnLabel.findMany({
    where: { labelType: 'OUTBOUND' },
    orderBy: { createdAt: 'desc' },
    select: {
      id:               true,
      amazonOrderId:    true,
      shipFromName:     true,
      shipFromAddress1: true,
      shipFromCity:     true,
      shipFromState:    true,
      shipFromPostal:   true,
      serviceCode:      true,
      serviceLabel:     true,
      weightValue:      true,
      weightUnit:       true,
      trackingNumber:   true,
      shipmentCost:     true,
      currency:         true,
      voided:           true,
      voidedAt:         true,
      createdAt:        true,
      upsCredential:    { select: { nickname: true } },
    },
  })

  return NextResponse.json(labels)
}
