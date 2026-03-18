/**
 * POST /api/fba-shipments/[id]/complete-serialization
 *
 * Validates all items are fully scanned → advances status DRAFT → SERIALIZED
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

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: {
      items: { include: { serialAssignments: true } },
    },
  })

  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (shipment.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Shipment must be in DRAFT status' }, { status: 409 })
  }

  // Validate every item is fully scanned
  const incomplete: string[] = []
  for (const item of shipment.items) {
    if (item.serialAssignments.length < item.quantity) {
      incomplete.push(`${item.sellerSku}: ${item.serialAssignments.length}/${item.quantity} scanned`)
    }
  }

  if (incomplete.length > 0) {
    return NextResponse.json(
      { error: `Not all items are fully scanned: ${incomplete.join(', ')}` },
      { status: 400 },
    )
  }

  await prisma.fbaShipment.update({
    where: { id: params.id },
    data: { status: 'SERIALIZED' },
  })

  return NextResponse.json({ success: true })
}
