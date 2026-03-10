/**
 * POST /api/listings/create
 * Body: { accountId, sku, asin, price, condition, fulfillmentChannel, quantity?, shippingTemplate? }
 *
 * Creates a new Amazon listing for an existing ASIN via the SP-API putListingsItem endpoint.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createListing, resolveTemplateGroupId } from '@/lib/amazon/listings'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

const bodySchema = z.object({
  accountId: z.string().min(1),
  sku: z.string().min(1),
  asin: z.string().regex(/^B0[A-Z0-9]{8}$/, 'Invalid ASIN format'),
  price: z.number().positive(),
  condition: z.string().min(1),
  fulfillmentChannel: z.enum(['MFN', 'FBA']),
  quantity: z.number().int().min(0).default(0),
  shippingTemplate: z.string().optional(),
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

    const { accountId, sku, asin, price, condition, fulfillmentChannel, quantity, shippingTemplate } = parsed.data

    // Resolve shipping template UUID if provided (MFN only)
    let shippingTemplateGroupId: string | undefined
    if (shippingTemplate && fulfillmentChannel === 'MFN') {
      shippingTemplateGroupId = await resolveTemplateGroupId(accountId, shippingTemplate)
    }

    const result = await createListing(
      accountId, sku, asin, price, quantity, fulfillmentChannel, condition, shippingTemplateGroupId,
    )

    return NextResponse.json({ success: true, ...result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/listings/create]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
