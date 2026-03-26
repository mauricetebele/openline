import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { description, sku, isSerializable, defaultPackagePresetId } = body

  if (!description?.trim()) return NextResponse.json({ error: 'Description is required' }, { status: 400 })
  if (!sku?.trim()) return NextResponse.json({ error: 'SKU is required' }, { status: 400 })

  // Check SKU uniqueness against other products
  const existing = await prisma.product.findUnique({ where: { sku: sku.trim() } })
  if (existing && existing.id !== params.id) {
    return NextResponse.json({ error: `SKU "${sku.trim()}" is already in use` }, { status: 409 })
  }

  const product = await prisma.product.update({
    where: { id: params.id },
    data: {
      description: description.trim(),
      sku: sku.trim(),
      isSerializable: Boolean(isSerializable),
      defaultPackagePresetId: defaultPackagePresetId !== undefined ? (defaultPackagePresetId || null) : undefined,
    },
  })

  return NextResponse.json(product)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = params.id

  // Check for related records that indicate usage history
  const [
    inventorySerials,
    serialHistory,
    orderReservations,
    salesOrderItems,
    vendorRMAItems,
    customerRMAItems,
    poLines,
    receiptLines,
  ] = await Promise.all([
    prisma.inventorySerial.count({ where: { productId: id } }),
    prisma.serialHistory.count({ where: { OR: [{ fromProductId: id }, { toProductId: id }] } }),
    prisma.orderInventoryReservation.count({ where: { productId: id } }),
    prisma.salesOrderItem.count({ where: { productId: id } }),
    prisma.vendorRMAItem.count({ where: { productId: id } }),
    prisma.customerRMAItem.count({ where: { productId: id } }),
    prisma.purchaseOrderLine.count({ where: { productId: id } }),
    prisma.pOReceiptLine.count({ where: { productId: id } }),
  ])

  const hasRelated =
    inventorySerials + serialHistory + orderReservations +
    salesOrderItems + vendorRMAItems + customerRMAItems +
    poLines + receiptLines > 0

  if (hasRelated) {
    // Soft-delete: archive the product
    await prisma.product.update({
      where: { id },
      data: { archivedAt: new Date() },
    })
    return NextResponse.json({ ok: true, archived: true })
  }

  // No related records — safe to hard-delete
  await prisma.product.delete({ where: { id } })
  return NextResponse.json({ ok: true, archived: false })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body as { action: string }

  if (action === 'restore') {
    const product = await prisma.product.update({
      where: { id: params.id },
      data: { archivedAt: null },
    })
    return NextResponse.json(product)
  }

  if (action === 'purge') {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only admins can permanently delete products' }, { status: 403 })
    }

    // Check for RESTRICT dependencies before hard-delete
    const [inventorySerials, salesOrderItems, orderReservations] = await Promise.all([
      prisma.inventorySerial.count({ where: { productId: params.id } }),
      prisma.salesOrderItem.count({ where: { productId: params.id } }),
      prisma.orderInventoryReservation.count({ where: { productId: params.id } }),
    ])

    if (inventorySerials + salesOrderItems + orderReservations > 0) {
      return NextResponse.json(
        { error: 'Cannot permanently delete: product still has inventory serials, order items, or reservations' },
        { status: 409 },
      )
    }

    await prisma.product.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
