import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.legacyRMA.findUnique({
    where: { id: params.id },
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          product: { select: { id: true, sku: true, description: true, isSerializable: true } },
          grade: { select: { id: true, grade: true } },
          vendor: { select: { id: true, name: true } },
          serials: {
            orderBy: { createdAt: 'asc' },
            include: {
              location: {
                include: { warehouse: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  })

  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rma)
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.legacyRMA.findUnique({
    where: { id: params.id },
    include: { items: { include: { serials: true } } },
  })
  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Block deletion if any serials have been received
  const totalSerials = rma.items.reduce((sum, i) => sum + i.serials.length, 0)
  if (totalSerials > 0) {
    return NextResponse.json({ error: 'Cannot delete — serials have been received against this RMA' }, { status: 400 })
  }

  await prisma.legacyRMA.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
