import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

type Ctx = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.legacyRMA.findUnique({ where: { id: params.id } })
  if (!rma) return NextResponse.json({ error: 'Legacy RMA not found' }, { status: 404 })

  const body = await req.json()
  const { productId, gradeId, vendorId, unitCost, quantity } = body

  if (!productId) return NextResponse.json({ error: 'Product is required' }, { status: 400 })

  const item = await prisma.legacyRMAItem.create({
    data: {
      rmaId: params.id,
      productId,
      gradeId: gradeId || null,
      vendorId: vendorId || rma.vendorId || null,
      unitCost: unitCost != null ? unitCost : null,
      quantity: quantity || 1,
    },
    include: {
      product: { select: { id: true, sku: true, description: true, isSerializable: true } },
      grade: { select: { id: true, grade: true } },
      vendor: { select: { id: true, name: true } },
      serials: true,
    },
  })

  return NextResponse.json(item, { status: 201 })
}
