/**
 * POST /api/listings/bulk-create
 *
 * Creates multiple Amazon listings in sequence with rate-limit delays.
 *
 * Body: {
 *   accountId: string
 *   condition: string
 *   fulfillmentChannel: 'MFN' | 'FBA'
 *   quantity: number
 *   shippingTemplate?: string
 *   items: Array<{ sku: string; asin: string; price: number }>
 * }
 *
 * Returns: {
 *   results: Array<{ sku: string; asin: string; success: boolean; error?: string }>
 *   succeeded: number
 *   failed: number
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createListing, resolveTemplateGroupId } from '@/lib/amazon/listings'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

const itemSchema = z.object({
  sku: z.string().min(1),
  asin: z.string().regex(/^B0[A-Z0-9]{8}$/, 'Invalid ASIN format'),
  price: z.number().positive(),
})

const bodySchema = z.object({
  accountId: z.string().min(1),
  condition: z.string().min(1),
  fulfillmentChannel: z.enum(['MFN', 'FBA']),
  quantity: z.number().int().min(0).default(0),
  shippingTemplate: z.string().optional(),
  items: z.array(itemSchema).min(1).max(200),
})

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min for large batches

const DELAY_MS = 400

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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

    const { accountId, condition, fulfillmentChannel, quantity, shippingTemplate, items } = parsed.data

    // Resolve shipping template UUID once if MFN
    let shippingTemplateGroupId: string | undefined
    if (shippingTemplate && fulfillmentChannel === 'MFN') {
      shippingTemplateGroupId = await resolveTemplateGroupId(accountId, shippingTemplate)
    }

    const results: { sku: string; asin: string; success: boolean; error?: string }[] = []

    for (let i = 0; i < items.length; i++) {
      const { sku, asin, price } = items[i]
      try {
        await createListing(
          accountId, sku, asin, price, quantity, fulfillmentChannel, condition, shippingTemplateGroupId,
        )
        results.push({ sku, asin, success: true })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[bulk-create] item ${i} (${sku}):`, message)
        results.push({ sku, asin, success: false, error: message })
      }

      // Rate-limit delay between calls (skip after last item)
      if (i < items.length - 1) {
        await delay(DELAY_MS)
      }
    }

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    return NextResponse.json({ results, succeeded, failed })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/listings/bulk-create]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
