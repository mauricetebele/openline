/**
 * POST   /api/product-families/[id]/members — add products { productIds: string[] }
 * DELETE /api/product-families/[id]/members?productId= — remove a product
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const productIds: string[] = Array.isArray(body?.productIds) ? body.productIds.filter(Boolean) : []
  if (productIds.length === 0) return NextResponse.json({ error: 'No products selected' }, { status: 400 })

  const family = await prisma.productFamily.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!family) return NextResponse.json({ error: 'Family not found' }, { status: 404 })

  const res = await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { familyId: params.id } })
  return NextResponse.json({ ok: true, added: res.count })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const productId = req.nextUrl.searchParams.get('productId')
  if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })
  // Only unassign if it currently belongs to this family.
  await prisma.product.updateMany({ where: { id: productId, familyId: params.id }, data: { familyId: null } })
  return NextResponse.json({ ok: true })
}
