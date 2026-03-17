import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

const ALLOWED_STATUSES = ['APPROVED_TO_RETURN', 'SHIPPED_AWAITING_CREDIT']

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.vendorRMA.findUnique({
    where: { id: params.id },
    include: {
      items: {
        include: {
          serials: true,
        },
      },
    },
  })

  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!ALLOWED_STATUSES.includes(rma.status)) {
    return NextResponse.json(
      { error: 'Scan-out is only available for returns in Approved to Return or Shipped & Awaiting Credit status' },
      { status: 400 },
    )
  }

  const body = await req.json()
  const { serialNumbers } = body as { serialNumbers: string[] }

  if (!Array.isArray(serialNumbers) || serialNumbers.length === 0) {
    return NextResponse.json({ error: 'serialNumbers array is required' }, { status: 400 })
  }

  // Build a lookup of all serials on this RMA (lowercase -> serial record)
  const allSerials = rma.items.flatMap(item => item.serials)
  const serialMap = new Map<string, typeof allSerials[number]>()
  for (const s of allSerials) {
    serialMap.set(s.serialNumber.toLowerCase(), s)
  }

  type ScanResult = { serialNumber: string; status: 'scanned' | 'already_scanned' | 'not_on_rma' }
  const results: ScanResult[] = []
  const toUpdate: string[] = []

  for (const sn of serialNumbers) {
    const match = serialMap.get(sn.toLowerCase())
    if (!match) {
      results.push({ serialNumber: sn, status: 'not_on_rma' })
    } else if (match.scannedOutAt) {
      results.push({ serialNumber: sn, status: 'already_scanned' })
    } else {
      results.push({ serialNumber: sn, status: 'scanned' })
      toUpdate.push(match.id)
    }
  }

  // Batch update in a single transaction
  if (toUpdate.length > 0) {
    await prisma.$transaction(
      toUpdate.map(id =>
        prisma.vendorRMASerial.update({
          where: { id },
          data: { scannedOutAt: new Date() },
        }),
      ),
    )
  }

  // Re-fetch the full RMA to return updated data
  const updated = await prisma.vendorRMA.findUnique({
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

  return NextResponse.json({ rma: updated, results })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { serialNumber } = body as { serialNumber: string }

  if (!serialNumber) {
    return NextResponse.json({ error: 'serialNumber is required' }, { status: 400 })
  }

  const rma = await prisma.vendorRMA.findUnique({
    where: { id: params.id },
    include: { items: { include: { serials: true } } },
  })

  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!ALLOWED_STATUSES.includes(rma.status)) {
    return NextResponse.json({ error: 'Cannot unscan in this status' }, { status: 400 })
  }

  const match = rma.items
    .flatMap(i => i.serials)
    .find(s => s.serialNumber.toLowerCase() === serialNumber.toLowerCase())

  if (!match) {
    return NextResponse.json({ error: 'Serial not found on this RMA' }, { status: 404 })
  }

  await prisma.vendorRMASerial.update({
    where: { id: match.id },
    data: { scannedOutAt: null },
  })

  const updated = await prisma.vendorRMA.findUnique({
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

  return NextResponse.json({ rma: updated })
}
