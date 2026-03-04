import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        orderBy: { orderItemId: 'asc' },
      },
      label: true,
      serialAssignments: {
        include: {
          inventorySerial: {
            select: { serialNumber: true, product: { select: { sku: true } } },
          },
          orderItem: { select: { sellerSku: true } },
        },
      },
      marketplaceRMAs: {
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            include: {
              serials: {
                include: {
                  location: {
                    include: { warehouse: { select: { name: true } } },
                  },
                  grade: { select: { grade: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  return NextResponse.json({ data: order })
}
