/**
 * POST /api/description-guesser
 *
 * Read-only. Given a list of SKUs, guesses a product description for each by
 * pattern-matching against the descriptions of existing products that share the
 * same SKU structure. Does NOT write to the database — SKUs that already exist
 * are skipped and reported separately.
 *
 * Body: { text: string }  // newline-separated SKUs
 *   or  { skus: string[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { guessDescriptions, normalizeSku } from '@/lib/description-guesser'

export const dynamic = 'force-dynamic'

const MAX_SKUS = 5000

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const raw: string[] = Array.isArray(body?.skus)
    ? body.skus.map(String)
    : typeof body?.text === 'string'
      ? body.text.split(/\r?\n/)
      : []

  const lines = raw.map(s => s.trim()).filter(Boolean)
  if (lines.length === 0) {
    return NextResponse.json({ error: 'No SKUs provided' }, { status: 400 })
  }
  if (lines.length > MAX_SKUS) {
    return NextResponse.json(
      { error: `Too many SKUs — limit is ${MAX_SKUS} per run (received ${lines.length}).` },
      { status: 400 },
    )
  }

  // Corpus = existing products + user-taught corrections. Both feed the pattern
  // learner; only products count as "already exists" (corrections are returned
  // as answers, not skipped). Read-only for products — corrections live in a
  // separate table written only by the /learn endpoint.
  const products = await prisma.product.findMany({ select: { sku: true, description: true } })
  const productPairs = products
    .filter(p => p.description && p.description.trim().length > 0)
    .map(p => ({ sku: p.sku, description: p.description }))

  const learnings = await prisma.$queryRaw<{ sku: string; description: string }[]>`
    SELECT sku, description FROM description_guess_learnings`

  const existingSkus = new Set(productPairs.map(p => normalizeSku(p.sku)))
  const overrides = new Map(learnings.map(l => [normalizeSku(l.sku), l.description]))
  const corpus = [...productPairs, ...learnings]

  const result = guessDescriptions(lines, corpus, { existingSkus, overrides })
  return NextResponse.json(result)
}
