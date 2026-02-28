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
      vendor: { select: { id: true, name: true } },
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
  return NextResponse.json(rma)
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
      ...(trackingNumber !== undefined && { trackingNumber: trackingNumber?.trim() || null }),
    },
    include: {
      vendor: { select: { id: true, name: true } },
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
