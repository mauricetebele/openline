/**
 * GET    /api/product-families/[id] — family + members with parsed attributes
 * PATCH  /api/product-families/[id] — rename { name }
 * DELETE /api/product-families/[id] — delete (members are unassigned, not deleted)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { parseProductAttrs } from '@/lib/product-attributes'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const family = await prisma.productFamily.findUnique({
    where: { id: params.id },
    include: {
      products: {
        orderBy: { description: 'asc' },
        select: { id: true, sku: true, description: true, isSerializable: true },
      },
    },
  })
  if (!family) return NextResponse.json({ error: 'Family not found' }, { status: 404 })

  const members = family.products.map(p => ({ ...p, attrs: parseProductAttrs(p.description) }))
  return NextResponse.json({ id: family.id, name: family.name, members })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = String(body?.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 })
  try {
    const updated = await prisma.productFamily.update({ where: { id: params.id }, data: { name } })
    return NextResponse.json({ id: updated.id, name: updated.name })
  } catch {
    return NextResponse.json({ error: 'Name already in use or family not found' }, { status: 409 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // onDelete: SetNull on Product.familyId unassigns members automatically.
  await prisma.productFamily.delete({ where: { id: params.id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
