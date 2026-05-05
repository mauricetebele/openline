/**
 * POST /api/marketplace-skus/bulk-backmarket
 *
 * Bulk-create BackMarket MSKU mappings + MarketplaceListing records,
 * then push listings to BackMarket via their CSV API.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient, BM_CONDITION_TO_STATE } from '@/lib/backmarket/client'

export const dynamic = 'force-dynamic'

interface RowInput {
  productId: string
  gradeId: string | null
  sellerSku: string
  bmId: string
  condition: string
  price: number
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
      if (typeof row.price !== 'number' || isNaN(row.price) || row.price <= 0) throw new Error('price must be > 0')

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

  // Push successfully created listings to BackMarket API
  const successRows = rows.filter(r => results.find(res => res.sellerSku === r.sellerSku.trim() && res.status === 'success'))
  let bmApiResponse: { success: boolean; error?: string; detail?: unknown } | undefined

  if (successRows.length > 0) {
    try {
      const credential = await prisma.backMarketCredential.findFirst({
        where: { isActive: true },
        select: { apiKeyEnc: true },
      })
      if (!credential) throw new Error('No active BackMarket credential configured')

      const client = new BackMarketClient(decrypt(credential.apiKeyEnc))
      const bmRows = successRows.map(r => {
        const state = BM_CONDITION_TO_STATE[r.condition.trim()]
        if (state === undefined) throw new Error(`Unknown BM condition: ${r.condition}`)
        return {
          sku: r.sellerSku.trim(),
          backmarketId: parseInt(r.bmId.trim(), 10),
          price: r.price,
          quantity: 1,
          state,
        }
      })

      const resp = await client.createListings(bmRows)
      console.log('[BackMarket] createListings response:', JSON.stringify(resp))
      bmApiResponse = { success: true, detail: resp }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[BackMarket] createListings failed:', msg)
      bmApiResponse = { success: false, error: msg }
    }
  }

  return NextResponse.json({ results, bmApi: bmApiResponse })
}
