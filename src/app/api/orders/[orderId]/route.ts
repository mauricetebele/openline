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

  // Historical SICKW/FMI checks for this order. SickwCheck has no FK — it's
  // keyed by the checked serial/IMEI — so gather every serial on the order
  // (shipped units, BackMarket serials, returned units) and batch-load.
  const serials = new Set<string>()
  for (const sa of order.serialAssignments) {
    if (sa.inventorySerial?.serialNumber) serials.add(sa.inventorySerial.serialNumber)
  }
  for (const item of order.items) {
    for (const s of (item.bmSerials ?? [])) if (s) serials.add(s)
  }
  for (const rma of order.marketplaceRMAs) {
    for (const item of rma.items) {
      for (const s of item.serials) if (s.serialNumber) serials.add(s.serialNumber)
    }
  }

  const rawChecks = serials.size > 0
    ? await prisma.sickwCheck.findMany({
        where: { imei: { in: Array.from(serials) } },
        orderBy: { createdAt: 'desc' },
      })
    : []
  const sickwChecks = rawChecks.map((c) => ({
    ...c,
    cost: c.cost != null ? Number(c.cost) : null, // Decimal → number over JSON
  }))

  return NextResponse.json({ data: { ...order, sickwChecks } })
}
