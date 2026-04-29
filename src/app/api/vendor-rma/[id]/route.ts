import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.vendorRMA.findUnique({
    where: { id: params.id },
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          product: { select: { id: true, sku: true, description: true, isSerializable: true } },
          serials: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  })

  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Enrich with live PO costs per serial (instead of stale snapshot)
  const allSerials = rma.items.flatMap(item => item.serials.map(s => s.serialNumber))
  const inventorySerials = allSerials.length > 0
    ? await prisma.inventorySerial.findMany({
        where: { serialNumber: { in: allSerials } },
        select: {
          serialNumber: true,
          unitCost: true,
          receiptLine: {
            select: {
              purchaseOrderLine: { select: { unitCost: true } },
            },
          },
        },
      })
    : []

  const liveCostMap = new Map(
    inventorySerials.map(s => [s.serialNumber,
      s.receiptLine?.purchaseOrderLine?.unitCost != null
        ? Number(s.receiptLine.purchaseOrderLine.unitCost)
        : (s.unitCost != null ? Number(s.unitCost) : null),
    ])
  )

  // Compute live unitCost per item from serial costs
  const enrichedItems = rma.items.map(item => {
    if (item.serials.length > 0) {
      const costs = item.serials.map(s => liveCostMap.get(s.serialNumber)).filter((c): c is number => c != null)
      const liveUnitCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null
      return { ...item, unitCost: liveUnitCost != null ? String(liveUnitCost) : item.unitCost }
    }
    return item
  })

  return NextResponse.json({ ...rma, items: enrichedItems })
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { notes, vendorApprovalNumber, carrier, trackingNumber } = body

  const rma = await prisma.vendorRMA.update({
    where: { id: params.id },
    data: {
      ...(notes !== undefined && { notes: notes?.trim() || null }),
      ...(vendorApprovalNumber !== undefined && { vendorApprovalNumber: vendorApprovalNumber?.trim() || null }),
      ...(carrier !== undefined && { carrier: carrier?.trim() || null }),
      ...(trackingNumber !== undefined && {
        trackingNumber: trackingNumber?.trim() || null,
        carrierStatus: null,
        deliveredAt: null,
        estimatedDelivery: null,
        trackingUpdatedAt: null,
      }),
    },
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          product: { select: { id: true, sku: true, description: true, isSerializable: true } },
          serials: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  })

  return NextResponse.json(rma)
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.vendorRMA.findUnique({ where: { id: params.id } })
  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (rma.status !== 'AWAITING_VENDOR_APPROVAL') {
    return NextResponse.json({ error: 'Only returns awaiting approval can be deleted' }, { status: 400 })
  }

  await prisma.vendorRMA.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
