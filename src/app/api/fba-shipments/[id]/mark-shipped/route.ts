/**
 * POST /api/fba-shipments/[id]/mark-shipped
 *
 * Marks shipment as shipped.
 * Status: LABELS_READY → SHIPPED
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({ where: { id: params.id } })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (shipment.status !== 'LABELS_READY') {
    return NextResponse.json({ error: 'Shipment must be in LABELS_READY status' }, { status: 409 })
  }

  await prisma.fbaShipment.update({
    where: { id: params.id },
    data: { status: 'SHIPPED' },
  })

  return NextResponse.json({ success: true })
}
