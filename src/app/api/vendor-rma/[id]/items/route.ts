import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { productId, quantity, unitCost, notes, serials } = body

  if (!productId) return NextResponse.json({ error: 'Product is required' }, { status: 400 })

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  if (product.isSerializable) {
    if (!Array.isArray(serials) || serials.length === 0) {
      return NextResponse.json({ error: 'At least one serial number is required for serializable products' }, { status: 400 })
    }

    // Check if any serial already exists on another vendor RMA
    const trimmedSerials = (serials as string[]).map((sn: string) => sn.trim())
    const existingVrmaSerials = await prisma.vendorRMASerial.findMany({
      where: { serialNumber: { in: trimmedSerials }, scannedOutAt: null },
      include: { rmaItem: { include: { rma: { select: { rmaNumber: true } } } } },
    })
    if (existingVrmaSerials.length > 0) {
      const dupes = existingVrmaSerials.map(s => `${s.serialNumber} (${s.rmaItem.rma.rmaNumber})`)
      return NextResponse.json({ error: `Serial(s) already on a Vendor RMA: ${dupes.join(', ')}` }, { status: 409 })
    }
  } else {
    if (!quantity || quantity < 1) {
      return NextResponse.json({ error: 'Quantity must be at least 1' }, { status: 400 })
    }
  }

  const item = await prisma.vendorRMAItem.create({
    data: {
      rmaId: params.id,
      productId,
      quantity: product.isSerializable ? (serials as string[]).length : quantity,
      unitCost: unitCost ?? null,
      notes: notes?.trim() || null,
      ...(product.isSerializable && serials?.length && {
        serials: {
          create: (serials as string[]).map((sn: string) => ({ serialNumber: sn.trim() })),
        },
      }),
    },
    include: {
      product: { select: { id: true, sku: true, description: true, isSerializable: true } },
      serials: { orderBy: { createdAt: 'asc' } },
    },
  })

  return NextResponse.json(item, { status: 201 })
}
