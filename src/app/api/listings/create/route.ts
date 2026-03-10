/**
 * POST /api/listings/create
 * Body: { accountId, sku, asin, price, condition, fulfillmentChannel, quantity?, shippingTemplate?,
 *         productId?, gradeId?, shippingTemplateGroupId? }
 *
 * Creates a new Amazon listing for an existing ASIN via the SP-API putListingsItem endpoint.
 * If productId is provided, also upserts a ProductGradeMarketplaceSku record.
 * If shippingTemplateGroupId is provided, skips resolving the template UUID.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createListing, resolveTemplateGroupId } from '@/lib/amazon/listings'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

const bodySchema = z.object({
  accountId: z.string().min(1),
  sku: z.string().min(1),
  asin: z.string().regex(/^B0[A-Z0-9]{8}$/, 'Invalid ASIN format'),
  price: z.number().positive(),
  condition: z.string().min(1),
  fulfillmentChannel: z.enum(['MFN', 'FBA']),
  quantity: z.number().int().min(0).default(0),
  shippingTemplate: z.string().optional(),
  productId: z.string().optional(),
  gradeId: z.string().nullable().optional(),
  shippingTemplateGroupId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const adminErr = requireAdmin(user)
    if (adminErr) return adminErr

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
    }

    const { accountId, sku, asin, price, condition, fulfillmentChannel, quantity, shippingTemplate, productId, gradeId } = parsed.data

    // Resolve shipping template UUID — use pre-resolved ID if provided, otherwise resolve by name
    let resolvedTemplateGroupId: string | undefined = parsed.data.shippingTemplateGroupId
    if (!resolvedTemplateGroupId && shippingTemplate && fulfillmentChannel === 'MFN') {
      resolvedTemplateGroupId = await resolveTemplateGroupId(accountId, shippingTemplate)
    }

    const result = await createListing(
      accountId, sku, asin, price, quantity, fulfillmentChannel, condition, resolvedTemplateGroupId,
    )

    // Upsert ProductGradeMarketplaceSku if productId was provided (non-blocking)
    if (productId) {
      try {
        const id = randomUUID()
        const gId = gradeId ?? null
        await prisma.$executeRawUnsafe(
          `INSERT INTO "product_grade_marketplace_skus" ("id", "productId", "gradeId", "marketplace", "accountId", "sellerSku", "syncQty", "isSynced", "createdAt")
           VALUES ($1, $2, $3, 'amazon', $4, $5, false, false, NOW())
           ON CONFLICT ("productId", "gradeId", "marketplace", "accountId")
           DO UPDATE SET "sellerSku" = EXCLUDED."sellerSku"`,
          id, productId, gId, accountId, sku,
        )
      } catch (upsertErr) {
        console.error('[POST /api/listings/create] MSKU upsert failed (non-fatal):', upsertErr)
      }
    }

    return NextResponse.json({ success: true, shippingTemplateGroupId: resolvedTemplateGroupId, ...result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[POST /api/listings/create]', message, stack ? `\n${stack}` : '')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
