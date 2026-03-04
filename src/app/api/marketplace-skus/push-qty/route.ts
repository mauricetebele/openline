/**
 * POST /api/marketplace-skus/push-qty
 *
 * Push available inventory quantities to marketplace SKUs that have syncQty enabled.
 *
 * Body (optional):
 *   { mskuId: string } — push only this single MSKU (used when toggling on)
 *   {} or no body      — push ALL enabled MSKUs
 *
 * Available = SUM(InventoryItem.qty for matching product/grade)
 *           - SUM(pending Amazon MFN order qty for that sellerSku)
 *
 * Supports an optional `?source=cron` query param (used by the cron endpoint to
 * skip auth — the cron route validates CRON_SECRET itself).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { updateListingQuantity as updateAmazonQty } from '@/lib/amazon/listings'
import { BackMarketClient } from '@/lib/backmarket/client'
import { decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface PushResult {
  sellerSku: string
  marketplace: string
  quantity: number
  error?: string
}

type MskuWithRelations = Awaited<ReturnType<typeof prisma.productGradeMarketplaceSku.findFirstOrThrow<{
  include: { product: { select: { id: true; sku: true } }; grade: { select: { id: true; grade: true } } }
}>>>

/**
 * Push quantity for a single MSKU. Handles inventory calculation + marketplace API call.
 */
async function pushOneQuantity(
  msku: MskuWithRelations,
  bmClient: BackMarketClient | null,
  bmListingsCache: Map<string, number> | null,
): Promise<PushResult> {
  // 1. Get available inventory for this product + grade
  const inventoryWhere: { productId: string; gradeId?: string | null } = {
    productId: msku.productId,
  }
  if (msku.gradeId) {
    inventoryWhere.gradeId = msku.gradeId
  }

  const { _sum } = await prisma.inventoryItem.aggregate({
    where: inventoryWhere,
    _sum: { qty: true },
  })
  const onHand = _sum.qty ?? 0

  // 2. Subtract Amazon Pending MFN order quantities (Amazon MSKUs only)
  let pendingQty = 0
  if (msku.marketplace === 'amazon') {
    const pendingItems = await prisma.orderItem.findMany({
      where: {
        sellerSku: msku.sellerSku,
        order: {
          orderStatus: 'Pending',
          fulfillmentChannel: 'MFN',
          orderSource: 'amazon',
        },
      },
      select: { quantityOrdered: true, quantityShipped: true },
    })
    pendingQty = pendingItems.reduce(
      (sum, item) => sum + (item.quantityOrdered - item.quantityShipped),
      0,
    )
  }

  // 3. Calculate final available
  const available = Math.max(0, onHand - pendingQty)

  // 4. Push to marketplace
  if (msku.marketplace === 'amazon') {
    const accountId = msku.accountId
    if (!accountId) {
      const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
      if (!account) throw new Error('No active Amazon account found')
      await updateAmazonQty(account.id, msku.sellerSku, available)
    } else {
      await updateAmazonQty(accountId, msku.sellerSku, available)
    }
  } else if (msku.marketplace === 'backmarket') {
    if (!bmClient || !bmListingsCache) {
      throw new Error('No active Back Market credentials')
    }
    const listingId = bmListingsCache.get(msku.sellerSku)
    if (!listingId) {
      throw new Error(`BM listing not found for SKU ${msku.sellerSku}`)
    }
    await bmClient.updateListingQuantity(listingId, available)
  }

  return { sellerSku: msku.sellerSku, marketplace: msku.marketplace, quantity: available }
}

/**
 * Initialize Back Market client + listings cache if needed.
 */
async function getBmContext(mskus: MskuWithRelations[]) {
  let bmClient: BackMarketClient | null = null
  let bmListingsCache: Map<string, number> | null = null

  const hasBM = mskus.some((m) => m.marketplace === 'backmarket')
  if (hasBM) {
    const cred = await prisma.backMarketCredential.findFirst({ where: { isActive: true } })
    if (cred) {
      const apiKey = decrypt(cred.apiKeyEnc)
      bmClient = new BackMarketClient(apiKey)
      const bmListings = await bmClient.fetchAllPages<{ sku: string; listing_id?: number }>(
        '/listings',
      )
      bmListingsCache = new Map()
      for (const l of bmListings) {
        if (l.sku && l.listing_id) bmListingsCache.set(l.sku, l.listing_id)
      }
    }
  }

  return { bmClient, bmListingsCache }
}

/**
 * Push quantities for all enabled MSKUs. Used by cron.
 */
export async function pushAllQuantities(): Promise<PushResult[]> {
  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: { syncQty: true },
    include: {
      product: { select: { id: true, sku: true } },
      grade: { select: { id: true, grade: true } },
    },
  })

  if (mskus.length === 0) return []

  const { bmClient, bmListingsCache } = await getBmContext(mskus)
  const results: PushResult[] = []

  for (const msku of mskus) {
    try {
      results.push(await pushOneQuantity(msku, bmClient, bmListingsCache))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[push-qty] Failed for ${msku.sellerSku}:`, msg)
      results.push({ sellerSku: msku.sellerSku, marketplace: msku.marketplace, quantity: -1, error: msg })
    }
  }

  return results
}

/**
 * Push quantity for a single MSKU by ID. Used when toggling syncQty on.
 */
export async function pushSingleQuantity(mskuId: string): Promise<PushResult> {
  const msku = await prisma.productGradeMarketplaceSku.findUniqueOrThrow({
    where: { id: mskuId },
    include: {
      product: { select: { id: true, sku: true } },
      grade: { select: { id: true, grade: true } },
    },
  })

  const { bmClient, bmListingsCache } = await getBmContext([msku])
  return pushOneQuantity(msku, bmClient, bmListingsCache)
}

export async function POST(req: NextRequest) {
  // Allow cron calls to skip auth (cron route validates CRON_SECRET itself)
  const source = req.nextUrl.searchParams.get('source')
  if (source !== 'cron') {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { mskuId } = body as { mskuId?: string }

    if (mskuId) {
      // Single MSKU push
      const result = await pushSingleQuantity(mskuId)
      return NextResponse.json({ pushed: [result], errors: [], total: 1 })
    }

    // Push all enabled
    const results = await pushAllQuantities()
    const pushed = results.filter((r) => !r.error)
    const errors = results.filter((r) => r.error)
    return NextResponse.json({ pushed, errors, total: results.length })
  } catch (err) {
    console.error('[push-qty]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Push failed' },
      { status: 500 },
    )
  }
}
