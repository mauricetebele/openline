/**
 * POST /api/orders/apply-default-package-presets
 * Body: { orderIds: string[], accountId: string }
 *
 * For each selected order, resolves the seller SKU → Product → defaultPackagePreset
 * and saves the preset on the order (staging step before rate shopping).
 *
 * Only processes single-qty orders. Multi-qty orders are skipped.
 *
 * Streams SSE events:
 *   { type: 'applied', orderId, amazonOrderId, olmNumber, presetId, presetName, error }
 *   { type: 'done',    applied, total, skipped, errors }
 *   { type: 'error',   error }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  orderIds:  z.array(z.string().min(1)).min(1),
  accountId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }

  const { orderIds, accountId } = parsed.data

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds }, accountId },
    include: { items: true },
  })
  if (orders.length === 0) return NextResponse.json({ error: 'No matching orders found' }, { status: 404 })

  // Build a map: sellerSku → Product (with defaultPackagePreset)
  // Two lookups: marketplace SKU mappings first, then direct product SKU match as fallback
  const allSkus = Array.from(new Set(orders.flatMap(o => o.items.map(i => i.sellerSku).filter((s): s is string => s != null))))

  const [skuMappings, directProducts] = await Promise.all([
    prisma.productGradeMarketplaceSku.findMany({
      where: { sellerSku: { in: allSkus } },
      include: {
        product: {
          include: { defaultPackagePreset: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.product.findMany({
      where: { sku: { in: allSkus } },
      include: { defaultPackagePreset: { select: { id: true, name: true } } },
    }),
  ])

  const skuToProduct = new Map<string, { id: string; defaultPackagePreset: { id: string; name: string } | null }>()
  for (const m of skuMappings) {
    skuToProduct.set(m.sellerSku, m.product)
  }
  // Fallback: direct product SKU match (e.g. when item SKU was changed to internal SKU)
  for (const p of directProducts) {
    if (!skuToProduct.has(p.sku)) {
      skuToProduct.set(p.sku, p)
    }
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let applied = 0
      let skipped = 0
      const errors: { orderId: string; amazonOrderId: string; error: string }[] = []

      try {
        for (const order of orders) {
          try {
            // Check single-qty constraint
            const totalQty = order.items.reduce((s, i) => s + i.quantityOrdered, 0)
            if (totalQty !== 1) {
              skipped++
              send({
                type: 'applied', orderId: order.id, amazonOrderId: order.amazonOrderId,
                olmNumber: order.olmNumber, presetId: null, presetName: null,
                error: `Skipped: ${totalQty} qty (only single-qty orders supported)`,
              })
              continue
            }

            // Find the seller SKU from the single item
            const item = order.items[0]
            const sellerSku = item?.sellerSku
            if (!sellerSku) {
              skipped++
              send({
                type: 'applied', orderId: order.id, amazonOrderId: order.amazonOrderId,
                olmNumber: order.olmNumber, presetId: null, presetName: null,
                error: 'Skipped: no seller SKU on order item',
              })
              continue
            }

            const product = skuToProduct.get(sellerSku)
            if (!product) {
              skipped++
              send({
                type: 'applied', orderId: order.id, amazonOrderId: order.amazonOrderId,
                olmNumber: order.olmNumber, presetId: null, presetName: null,
                error: `Skipped: SKU "${sellerSku}" not mapped to a product`,
              })
              continue
            }

            if (!product.defaultPackagePreset) {
              skipped++
              send({
                type: 'applied', orderId: order.id, amazonOrderId: order.amazonOrderId,
                olmNumber: order.olmNumber, presetId: null, presetName: null,
                error: 'Skipped: product has no default package preset',
              })
              continue
            }

            // Save the package preset on the order
            await prisma.order.update({
              where: { id: order.id },
              data: { appliedPackagePresetId: product.defaultPackagePreset.id },
            })

            applied++
            send({
              type: 'applied', orderId: order.id, amazonOrderId: order.amazonOrderId,
              olmNumber: order.olmNumber,
              presetId: product.defaultPackagePreset.id,
              presetName: product.defaultPackagePreset.name,
              error: null,
            })

          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            errors.push({ orderId: order.id, amazonOrderId: order.amazonOrderId, error: msg })
            send({
              type: 'applied', orderId: order.id, amazonOrderId: order.amazonOrderId,
              olmNumber: order.olmNumber, presetId: null, presetName: null, error: msg,
            })
          }
        }

        send({ type: 'done', applied, total: orders.length, skipped, errors })
      } catch (fatalErr) {
        send({ type: 'error', error: fatalErr instanceof Error ? fatalErr.message : String(fatalErr) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
