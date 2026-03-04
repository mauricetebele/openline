import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search')?.trim()
  const status = searchParams.get('status')

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (search) {
    where.OR = [
      { rmaNumber: { contains: search, mode: 'insensitive' } },
      { order: { shipToName: { contains: search, mode: 'insensitive' } } },
      { order: { amazonOrderId: { contains: search, mode: 'insensitive' } } },
      { items: { some: { serials: { some: { serialNumber: { contains: search, mode: 'insensitive' } } } } } },
    ]
  }

  const rmas = await prisma.marketplaceRMA.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      order: {
        select: {
          id: true,
          olmNumber: true,
          amazonOrderId: true,
          orderSource: true,
          shipToName: true,
        },
      },
      items: {
        select: {
          id: true,
          sellerSku: true,
          title: true,
          quantityReturned: true,
          returnReason: true,
          serials: {
            select: {
              id: true,
              serialNumber: true,
              receivedAt: true,
              note: true,
              location: { select: { name: true, warehouse: { select: { name: true } } } },
              grade: { select: { grade: true } },
            },
          },
        },
      },
    },
  })

  return NextResponse.json({ data: rmas })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { orderId, notes, items } = body as {
    orderId: string
    notes?: string
    items: Array<{
      orderItemId: string
      productId?: string
      sellerSku?: string
      asin?: string
      title?: string
      quantityReturned: number
      returnReason?: string
      serials?: Array<{ serialNumber: string; inventorySerialId?: string }>
    }>
  }

  if (!orderId) return NextResponse.json({ error: 'Order is required' }, { status: 400 })
  if (!items?.length) return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })

  // Validate order is SHIPPED
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, workflowStatus: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.workflowStatus !== 'SHIPPED') {
    return NextResponse.json({ error: 'Order must be in SHIPPED status' }, { status: 400 })
  }

  // Validate serials belong to this order
  for (const item of items) {
    if (!item.serials?.length) continue
    for (const s of item.serials) {
      if (!s.inventorySerialId) continue
      const assignment = await prisma.orderSerialAssignment.findFirst({
        where: {
          orderId,
          orderItemId: item.orderItemId,
          inventorySerialId: s.inventorySerialId,
        },
      })
      if (!assignment) {
        return NextResponse.json(
          { error: `Serial ${s.serialNumber} is not assigned to this order item` },
          { status: 400 },
        )
      }
    }
  }

  // Auto-generate rmaNumber: MP-RMA-0001
  const last = await prisma.marketplaceRMA.findFirst({ orderBy: { createdAt: 'desc' } })
  let nextNum = 1
  if (last) {
    const match = last.rmaNumber.match(/MP-RMA-(\d+)/)
    if (match) nextNum = parseInt(match[1], 10) + 1
  }
  const rmaNumber = `MP-RMA-${String(nextNum).padStart(4, '0')}`

  try {
    const rma = await prisma.marketplaceRMA.create({
      data: {
        rmaNumber,
        orderId,
        notes: notes?.trim() || null,
        items: {
          create: items.map((item) => ({
            orderItemId: item.orderItemId,
            productId: item.productId?.trim() || null,
            sellerSku: item.sellerSku?.trim() || null,
            asin: item.asin?.trim() || null,
            title: item.title?.trim() || null,
            quantityReturned: item.quantityReturned,
          returnReason: item.returnReason?.trim() || null,
            serials: item.serials?.length
              ? {
                  create: item.serials.map((s) => ({
                    serialNumber: s.serialNumber,
                    inventorySerialId: s.inventorySerialId?.trim() || null,
                  })),
                }
              : undefined,
          })),
        },
      },
      include: {
        order: {
          select: {
            id: true,
            olmNumber: true,
            amazonOrderId: true,
            orderSource: true,
            shipToName: true,
          },
        },
        items: {
          include: {
            serials: true,
          },
        },
      },
    })

    return NextResponse.json(rma, { status: 201 })
  } catch (err) {
    console.error('[MP-RMA Create] Error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
