/**
 * POST /api/inventory/manual-add
 * Manually add inventory for a SKU without a Purchase Order.
 *
 * Body: {
 *   sku:        string          // must match an existing Product
 *   locationId: string          // target warehouse location
 *   qty:        number          // must be >= 1
 *   reason:     string          // 'New Stock' | 'Return' | 'Order Edit'
 *   serials?:   string[]        // required (and length must equal qty) when product.isSerializable
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  sku:        z.string().min(1),
  locationId: z.string().min(1),
  qty:        z.number().int().min(1),
  reason:     z.enum(['New Stock', 'Return', 'Order Edit']),
  gradeId:    z.string().optional().nullable(),
  serials:    z.array(z.string().min(1)).optional(),
})

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const { sku, locationId, qty, reason, gradeId, serials } = parsed.data

  // ── Resolve product ────────────────────────────────────────────────────────
  const product = await prisma.product.findUnique({ where: { sku } })
  if (!product) {
    return NextResponse.json({ error: `No product found with SKU "${sku}"` }, { status: 404 })
  }

  // ── Resolve location ───────────────────────────────────────────────────────
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: { warehouse: true },
  })
  if (!location) {
    return NextResponse.json({ error: 'Location not found' }, { status: 404 })
  }

  // ── Serializable validation ────────────────────────────────────────────────
  if (product.isSerializable) {
    if (!serials || serials.length === 0) {
      return NextResponse.json(
        { error: 'Serial numbers are required for serializable products' },
        { status: 400 },
      )
    }
    if (serials.length !== qty) {
      return NextResponse.json(
        { error: `Expected ${qty} serial number(s), got ${serials.length}` },
        { status: 400 },
      )
    }
    // Check for duplicates within submission
    const unique = new Set(serials.map(s => s.trim().toUpperCase()))
    if (unique.size !== serials.length) {
      return NextResponse.json({ error: 'Duplicate serial numbers in submission' }, { status: 400 })
    }
    // Check for duplicates against existing serials
    const trimmed = serials.map(s => s.trim())
    const upperTrimmed = trimmed.map(s => s.toUpperCase())
    const lowerTrimmed = trimmed.map(s => s.toLowerCase())
    const allVariants = Array.from(new Set([...trimmed, ...upperTrimmed, ...lowerTrimmed]))

    const existing = await prisma.inventorySerial.findMany({
      where: { serialNumber: { in: allVariants } },
      select: { id: true, serialNumber: true, status: true, productId: true, product: { select: { sku: true } } },
    })

    // Hard block: serials currently IN_STOCK
    const inStock = existing.filter(e => e.status === 'IN_STOCK')
    if (inStock.length > 0) {
      const dupes = inStock.map(s => `${s.serialNumber} (${s.product.sku})`).join(', ')
      return NextResponse.json(
        { error: `Serial(s) already in stock: ${dupes}` },
        { status: 409 },
      )
    }

  }

  // ── Apply in a transaction ─────────────────────────────────────────────────
  // Re-build reusable map inside transaction scope (variable scoping)
  const reusableMap = new Map<string, string>()
  if (product.isSerializable && serials) {
    const trimmed = serials.map(s => s.trim())
    const upperTrimmed = trimmed.map(s => s.toUpperCase())
    const lowerTrimmed = trimmed.map(s => s.toLowerCase())
    const allVariants = Array.from(new Set([...trimmed, ...upperTrimmed, ...lowerTrimmed]))
    const existing = await prisma.inventorySerial.findMany({
      where: { serialNumber: { in: allVariants }, status: { not: 'IN_STOCK' } },
      select: { id: true, serialNumber: true },
    })
    for (const e of existing) reusableMap.set(e.serialNumber.toUpperCase(), e.id)
  }

  try {
    await prisma.$transaction(async tx => {
      if (product.isSerializable && serials) {
        for (const sn of serials) {
          const existingId = reusableMap.get(sn.trim().toUpperCase())
          let serialId: string

          if (existingId) {
            // Re-activate existing serial (was shipped out / removed previously)
            await tx.inventorySerial.update({
              where: { id: existingId },
              data: {
                status:     'IN_STOCK',
                locationId: location.id,
                gradeId:    gradeId ?? null,
                productId:  product.id,
              },
            })
            serialId = existingId
          } else {
            const serial = await tx.inventorySerial.create({
              data: {
                serialNumber: sn.trim(),
                productId:    product.id,
                locationId:   location.id,
                gradeId:      gradeId ?? null,
                status:       'IN_STOCK',
              },
            })
            serialId = serial.id
          }

          await tx.serialHistory.create({
            data: {
              inventorySerialId: serialId,
              eventType:         'MANUAL_ADD',
              locationId:        location.id,
              userId:            user.dbId,
              notes:             `Manual add — Reason: ${reason}`,
            },
          })
        }
      }

      // Upsert inventory item quantity (grade-aware)
      // Prisma's composite unique where clause does NOT support null values,
      // so we use findFirst + create/update when gradeId is null.
      const resolvedGradeId = gradeId ?? null
      if (resolvedGradeId) {
        await tx.inventoryItem.upsert({
          where:  { productId_locationId_gradeId: { productId: product.id, locationId: location.id, gradeId: resolvedGradeId } },
          create: { productId: product.id, locationId: location.id, gradeId: resolvedGradeId, qty },
          update: { qty: { increment: qty } },
        })
      } else {
        const existing = await tx.inventoryItem.findFirst({
          where: { productId: product.id, locationId: location.id, gradeId: null },
        })
        if (existing) {
          await tx.inventoryItem.update({
            where: { id: existing.id },
            data:  { qty: { increment: qty } },
          })
        } else {
          await tx.inventoryItem.create({
            data: { productId: product.id, locationId: location.id, gradeId: null, qty },
          })
        }
      }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[manual-add] Transaction error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ success: true, added: qty })
}
