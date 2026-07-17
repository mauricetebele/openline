/**
 * POST /api/description-guesser/create
 *
 * Creates real products from selected guessed rows. This DOES write to the
 * products table (unlike the guess/learn endpoints). SKUs that already exist are
 * skipped, never overwritten.
 *
 * Body: { items: { sku: string; description: string }[], isSerializable?: boolean }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { normalizeSku } from '@/lib/description-guesser'

export const dynamic = 'force-dynamic'

const MAX_ITEMS = 5000

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const rawItems: unknown = body?.items
  const isSerializable = body?.isSerializable === true

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: 'No items provided' }, { status: 400 })
  }
  if (rawItems.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Too many items — limit is ${MAX_ITEMS}.` }, { status: 400 })
  }

  // Normalise, validate, and de-duplicate the requested items.
  const bySku = new Map<string, string>()
  for (const it of rawItems) {
    const sku = typeof (it as { sku?: unknown })?.sku === 'string' ? normalizeSku((it as { sku: string }).sku) : ''
    const description =
      typeof (it as { description?: unknown })?.description === 'string'
        ? (it as { description: string }).description.trim()
        : ''
    if (!sku || !description) continue
    bySku.set(sku, description) // last write wins on dup sku
  }
  if (bySku.size === 0) {
    return NextResponse.json({ error: 'No valid items (each needs a SKU and a non-empty description).' }, { status: 400 })
  }

  const requestedSkus = Array.from(bySku.keys())

  // Skip anything that already exists — never overwrite an existing product.
  const existing = await prisma.product.findMany({
    where: { sku: { in: requestedSkus } },
    select: { sku: true },
  })
  const existingSet = new Set(existing.map(e => e.sku))

  const toCreate = requestedSkus
    .filter(sku => !existingSet.has(sku))
    .map(sku => ({ sku, description: bySku.get(sku)!, isSerializable }))

  let created = 0
  if (toCreate.length > 0) {
    const res = await prisma.product.createMany({ data: toCreate, skipDuplicates: true })
    created = res.count
  }

  return NextResponse.json({
    created,
    createdSkus: toCreate.map(t => t.sku),
    skippedExisting: Array.from(existingSet),
  })
}
