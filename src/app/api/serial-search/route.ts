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
          warehouse: { select: { id: true, name: true } },
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
      },
    },
  })

  const foundSerials = new Set(records.map(r => r.serialNumber.toLowerCase()))
  const notFound = requested.filter(s => !foundSerials.has(s.toLowerCase()))

  const found = records.map(r => {
    const pol = r.receiptLine?.purchaseOrderLine
    const po  = pol?.purchaseOrder
    const lastHistory = r.history[0] ?? null
    const lastMovement = r.history.find(h => h.eventType !== 'BIN_ASSIGNED' && h.eventType !== 'NOTE_ADDED') ?? null
    return {
      id:            r.id,
      serialNumber:  r.serialNumber,
      status:        r.status,
      sku:           r.product.sku,
      description:   r.product.description,
      vendor:        po?.vendor.name ?? null,
      lastEventType: lastHistory?.eventType ?? null,
      lastEventDate: lastHistory?.createdAt ?? null,
      lastMovementType: lastMovement?.eventType ?? null,
      lastMovementDate: lastMovement?.createdAt ?? null,
      location:      r.location ? `${r.location.warehouse.name} / ${r.location.name}` : null,
      locationId:    r.locationId,
      warehouseId:   r.location?.warehouse?.id ?? null,
      poNumber:      po ? String(po.poNumber) : null,
      cost:          pol?.unitCost != null ? Number(pol.unitCost) : null,
      note:          r.note ?? null,
      binLocation:   r.binLocation ?? null,
    }
  })

  return NextResponse.json({ found, notFound })
}

/** POST handler — accepts { serials: string[] } in JSON body (used by manual-add validation) */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { serials?: string[] }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const requested = (body.serials ?? [])
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
    },
  })

  const foundSerials = new Set(records.map(r => r.serialNumber.toLowerCase()))
  const notFound = requested.filter(s => !foundSerials.has(s.toLowerCase()))

  const found = records.map(r => ({
    id:           r.id,
    serialNumber: r.serialNumber,
    status:       r.status,
    sku:          r.product.sku,
    description:  r.product.description,
    location:     r.location ? `${r.location.warehouse.name} / ${r.location.name}` : null,
  }))

  return NextResponse.json({ found, notFound })
}
