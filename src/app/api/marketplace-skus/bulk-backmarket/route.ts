/**
 * POST /api/marketplace-skus/bulk-backmarket
 *
 * Bulk-create BackMarket MSKU mappings + MarketplaceListing records.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

interface RowInput {
  productId: string
  gradeId: string | null
  sellerSku: string
  bmId: string
  condition: string
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const rows: RowInput[] = body.rows

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows array is required' }, { status: 400 })
  }

  const results: { sellerSku: string; status: 'success' | 'error'; error?: string }[] = []

  for (const row of rows) {
    try {
      if (!row.productId?.trim()) throw new Error('productId is required')
      if (!row.sellerSku?.trim()) throw new Error('sellerSku is required')
      if (!row.bmId?.trim() || !/^\d+$/.test(row.bmId.trim())) throw new Error('bmId must be a numeric string')
      if (!row.condition?.trim()) throw new Error('condition is required')

      const sellerSku = row.sellerSku.trim()
      const bmId = row.bmId.trim()
      const condition = row.condition.trim()

      await prisma.$transaction(async (tx) => {
        // 1. Create ProductGradeMarketplaceSku
        const msku = await tx.productGradeMarketplaceSku.create({
          data: {
            productId: row.productId,
            gradeId: row.gradeId || null,
            marketplace: 'backmarket',
            accountId: null,
            sellerSku,
          },
        })

        // 2. Upsert MarketplaceListing
        const existing = await tx.marketplaceListing.findFirst({
          where: {
            marketplace: 'backmarket',
            sellerSku,
            accountId: null,
          },
        })

        if (existing) {
          await tx.marketplaceListing.update({
            where: { id: existing.id },
            data: {
              externalId: bmId,
              condition,
              mskuId: msku.id,
            },
          })
        } else {
          await tx.marketplaceListing.create({
            data: {
              marketplace: 'backmarket',
              sellerSku,
              accountId: null,
              externalId: bmId,
              condition,
              mskuId: msku.id,
            },
          })
        }
      })

      results.push({ sellerSku, status: 'success' })
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string }
      let msg = e.message ?? 'Unknown error'
      if (e.code === 'P2002') msg = 'Seller SKU already exists for backmarket'
      results.push({ sellerSku: row.sellerSku, status: 'error', error: msg })
    }
  }

  return NextResponse.json({ results })
}
