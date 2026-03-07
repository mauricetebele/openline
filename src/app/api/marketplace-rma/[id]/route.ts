import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.marketplaceRMA.findUnique({
    where: { id: params.id },
    include: {
      order: {
        select: {
          id: true,
          olmNumber: true,
          amazonOrderId: true,
          orderSource: true,
          shipToName: true,
          shipToCity: true,
          shipToState: true,
        },
      },
      items: {
        include: {
          product: { select: { id: true, sku: true, description: true, isSerializable: true } },
          orderItem: { select: { id: true, quantityOrdered: true, sellerSku: true, title: true } },
          serials: {
            include: {
              location: {
                include: { warehouse: { select: { id: true, name: true } } },
              },
              grade: { select: { id: true, grade: true } },
            },
          },
        },
      },
    },
  })

  if (!rma) return NextResponse.json({ error: 'RMA not found' }, { status: 404 })

  return NextResponse.json({ data: rma })
}

/**
 * DELETE /api/marketplace-rma/[id]
 * Deletes an unreceived (OPEN) RMA. Cascades to items and serials.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const rma = await prisma.marketplaceRMA.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, rmaNumber: true },
  })

  if (!rma) return NextResponse.json({ error: 'RMA not found' }, { status: 404 })

  if (rma.status !== 'OPEN') {
    return NextResponse.json(
      { error: 'Only unreceived (OPEN) returns can be deleted' },
      { status: 400 },
    )
  }

  // Cascade deletes items and serials (defined in schema)
  await prisma.marketplaceRMA.delete({ where: { id: params.id } })

  return NextResponse.json({ ok: true, rmaNumber: rma.rmaNumber })
}
