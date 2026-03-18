/**
 * GET /api/fba-shipments/[id] — full detail of one FBA shipment
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: {
      account: { select: { id: true, sellerId: true, marketplaceId: true, marketplaceName: true } },
      warehouse: true,
      items: {
        include: {
          msku: {
            select: {
              id: true, sellerSku: true,
              product: { select: { id: true, sku: true, description: true } },
              grade: { select: { id: true, grade: true } },
            },
          },
          boxItems: { include: { box: true } },
          serialAssignments: {
            include: {
              inventorySerial: {
                select: { id: true, serialNumber: true, productId: true, gradeId: true },
              },
            },
          },
        },
      },
      boxes: {
        include: { items: true },
        orderBy: { boxNumber: 'asc' },
      },
      reservations: true,
    },
  })

  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })

  return NextResponse.json(shipment)
}
