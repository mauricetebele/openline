/**
 * POST /api/description-guesser/learn
 *
 * Records a user-corrected SKU→description pair so the guesser learns from it.
 * Writes ONLY to the `description_guess_learnings` table — never to products.
 *
 * Body: { sku: string, description: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { normalizeSku } from '@/lib/description-guesser'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const sku = typeof body?.sku === 'string' ? normalizeSku(body.sku) : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''

  if (!sku) return NextResponse.json({ error: 'sku is required' }, { status: 400 })
  if (!description) return NextResponse.json({ error: 'description is required' }, { status: 400 })

  // Upsert the correction. Idempotent on sku.
  await prisma.$executeRaw`
    INSERT INTO description_guess_learnings (id, sku, description, created_at, updated_at)
    VALUES (${randomUUID()}, ${sku}, ${description}, now(), now())
    ON CONFLICT (sku) DO UPDATE
      SET description = EXCLUDED.description, updated_at = now()`

  return NextResponse.json({ success: true, sku, description })
}
