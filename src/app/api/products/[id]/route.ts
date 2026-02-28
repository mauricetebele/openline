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
  const { description, sku, isSerializable } = body

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

  await prisma.product.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
