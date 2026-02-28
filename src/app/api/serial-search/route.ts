import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('serials') ?? ''
  const requested = raw
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i)

  if (requested.length === 0) return NextResponse.json({ found: [], notFound: [] })
  if (requested.length > 200) return NextResponse.json({ error: 'Maximum 200 serials per search' }, { status: 400 })

  const records = await prisma.inventorySerial.findMany({
    where: { serialNumber: { in: requested, mode: 'insensitive' } },
    include: {
      product: { select: { sku: true, description: true } },
      location: {
        select: {
          name: true,
          warehouse: { select: { name: true } },
        },
      },
      receiptLine: {
        include: {
          purchaseOrderLine: {
            include: {
              purchaseOrder: {
                include: { vendor: { select: { name: true } } },
              },
            },
          },
        },
      },
      history: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  const foundSerials = new Set(records.map(r => r.serialNumber.toLowerCase()))
  const notFound = requested.filter(s => !foundSerials.has(s.toLowerCase()))

  const found = records.map(r => {
    const pol = r.receiptLine?.purchaseOrderLine
    const po  = pol?.purchaseOrder
    const lastHistory = r.history[0] ?? null
    return {
      id:            r.id,
      serialNumber:  r.serialNumber,
      status:        r.status,
      sku:           r.product.sku,
      description:   r.product.description,
      vendor:        po?.vendor.name ?? null,
      lastEventType: lastHistory?.eventType ?? null,
      lastEventDate: lastHistory?.createdAt ?? null,
      location:      r.location ? `${r.location.warehouse.name} / ${r.location.name}` : null,
      poNumber:      po ? String(po.poNumber) : null,
      cost:          pol?.unitCost != null ? Number(pol.unitCost) : null,
      note:          r.note ?? null,
    }
  })

  return NextResponse.json({ found, notFound })
}
