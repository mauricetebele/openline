/**
 * GET /api/removal-shipments/:id — Single shipment with all items
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const shipment = await prisma.removalShipment.findUnique({
    where: { id },
    include: { items: true },
  })

  if (!shipment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(shipment)
}
