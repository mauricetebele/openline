/**
 * GET  /api/rma?amazonOrderId=   — list existing RMAs for an order
 * POST /api/rma                  — create a new RMA (validates order is shipped)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const amazonOrderId = searchParams.get('amazonOrderId')?.trim()
  if (!amazonOrderId) return NextResponse.json({ error: 'Missing amazonOrderId' }, { status: 400 })

  const rmas = await prisma.rMA.findMany({
    where: { amazonOrderId },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ data: rmas })
}

// ─── POST ─────────────────────────────────────────────────────────────────────

interface RMAItemInput {
  orderItemId: string
  sellerSku: string | null
  asin: string | null
  title: string | null
  quantityReturned: number
  condition: string
  restockToInventory: boolean
  locationId: string | null
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { rmaNumber, amazonOrderId, reason, notes, items } = body as {
    rmaNumber: string
    amazonOrderId: string
    reason: string
    notes: string | null
    items: RMAItemInput[]
  }

  if (!rmaNumber?.trim()) return NextResponse.json({ error: 'RMA number is required' }, { status: 400 })
  if (!amazonOrderId)      return NextResponse.json({ error: 'amazonOrderId is required' }, { status: 400 })
  if (!reason)             return NextResponse.json({ error: 'Reason is required' }, { status: 400 })
  if (!items?.length)      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })

  // ── Validate: order must be shipped ─────────────────────────────────────────
  const order = await prisma.order.findFirst({
    where: { amazonOrderId },
    select: { orderStatus: true },
  })

  const isShipped = ['Shipped', 'PartiallyShipped'].includes(order?.orderStatus ?? '')

  if (!isShipped) {
    return NextResponse.json(
      { error: 'Cannot create a return for an order that has not been shipped.' },
      { status: 422 },
    )
  }

  // ── Create RMA in a transaction ──────────────────────────────────────────────
  const restockResults: { sku: string; restocked: boolean; reason?: string }[] = []

  const rma = await prisma.$transaction(async (tx) => {
    const created = await tx.rMA.create({
      data: {
        rmaNumber: rmaNumber.trim(),
        amazonOrderId,
        reason,
        notes: notes ?? null,
        items: {
          create: items.map((item) => ({
            orderItemId:        item.orderItemId,
            sellerSku:          item.sellerSku ?? null,
            asin:               item.asin ?? null,
            title:              item.title ?? null,
            quantityReturned:   Math.max(1, item.quantityReturned),
            condition:          item.condition,
            restockToInventory: item.restockToInventory,
            restockedLocationId: item.restockToInventory && item.locationId ? item.locationId : null,
          })),
        },
      },
      include: { items: true },
    })

    // ── Restock items that requested it ────────────────────────────────────────
    for (const rmaItem of created.items) {
      if (!rmaItem.restockToInventory || !rmaItem.restockedLocationId || !rmaItem.sellerSku) {
        continue
      }

      try {
        // Product lookup by SKU
        const product = await tx.product.findUnique({ where: { sku: rmaItem.sellerSku } })
        if (!product) {
          restockResults.push({ sku: rmaItem.sellerSku, restocked: false, reason: 'Product not found in catalog' })
          continue
        }

        // Upsert inventory item (no grade for RMA restocks — goes into ungraded stock)
        await tx.inventoryItem.upsert({
          where: {
            productId_locationId_gradeId: { productId: product.id, locationId: rmaItem.restockedLocationId, gradeId: null },
          },
          update: { qty: { increment: rmaItem.quantityReturned } },
          create: {
            productId:  product.id,
            locationId: rmaItem.restockedLocationId,
            gradeId:    null,
            qty:        rmaItem.quantityReturned,
          },
        })

        // Mark the RMAItem as restocked
        await tx.rMAItem.update({
          where: { id: rmaItem.id },
          data: { restockedQty: rmaItem.quantityReturned, restockedAt: new Date() },
        })

        restockResults.push({ sku: rmaItem.sellerSku, restocked: true })
      } catch (e: unknown) {
        restockResults.push({
          sku: rmaItem.sellerSku,
          restocked: false,
          reason: e instanceof Error ? e.message : 'Unknown error',
        })
      }
    }

    return created
  })

  return NextResponse.json({ rma, restockResults }, { status: 201 })
}
