/**
 * POST /api/marketplace-skus/push-qty
 *
 * Push available inventory quantities to marketplace SKUs that have syncQty enabled.
 *
 * Body (optional):
 *   { mskuId: string } — push only this single MSKU (used when toggling on)
 *   {} or no body      — push ALL enabled MSKUs
 *
 * Available = SUM(InventoryItem.qty in finished-goods locations for matching product/grade)
 *           - SUM(pending Amazon MFN order qty for that sellerSku)
 *           - SUM(wholesale soft-reserved qty)
 *
 * Supports an optional `?source=cron` query param (used by the cron endpoint to
 * skip auth — the cron route validates CRON_SECRET itself).
 *
 * Rock-solid design:
 *   - Bulk DB queries upfront (3 queries for all SKUs vs per-SKU)
 *   - Skips unchanged quantities (lastPushedQty on MSKU)
 *   - Eliminates GET listing call (uses 'PRODUCT' productType, auto-retries on reject)
 *   - Timeout awareness (stops 10s before Vercel limit)
 *   - Stale-first ordering (least-recently-pushed SKUs get priority)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { updateListingQuantity as updateAmazonQty, submitInventoryFeed } from '@/lib/amazon/listings'
import { BackMarketClient } from '@/lib/backmarket/client'
import { decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Stop processing 10s before Vercel kills us — leaves time for cleanup
const TIMEOUT_MS = 110_000

interface PushResult {
  sellerSku: string
  marketplace: string
  quantity: number
  error?: string
}

export type MskuWithRelations = Awaited<ReturnType<typeof prisma.productGradeMarketplaceSku.findFirstOrThrow<{
  include: { product: { select: { id: true; sku: true } }; grade: { select: { id: true; grade: true } } }
}>>>

// ─── Composite key for product+grade lookups ────────────────────────────────

function pgKey(productId: string, gradeId: string | null | undefined): string {
  return `${productId}::${gradeId ?? 'NULL'}`
}

// ─── Bulk quantity pre-computation ──────────────────────────────────────────

export interface BulkQuantities {
  inventoryMap: Map<string, number>   // pgKey → on-hand qty
  pendingMap: Map<string, number>     // sellerSku → pending MFN order qty
  wholesaleMap: Map<string, number>   // pgKey → wholesale reserved qty
  listingQtyMap: Map<string, number>  // sellerSku::accountId → current Amazon qty
}

async function computeBulkQuantities(mskus: MskuWithRelations[]): Promise<BulkQuantities> {
  const productIds = Array.from(new Set(mskus.map(m => m.productId)))
  const amazonSkus = Array.from(new Set(mskus.filter(m => m.marketplace === 'amazon').map(m => m.sellerSku)))
  const allSkus = Array.from(new Set(mskus.map(m => m.sellerSku)))

  // 1. On-hand inventory grouped by product+grade (finished-goods locations only)
  const invGroups = await prisma.inventoryItem.groupBy({
    by: ['productId', 'gradeId'],
    where: {
      productId: { in: productIds },
      location: { isFinishedGoods: true },
    },
    _sum: { qty: true },
  })
  const inventoryMap = new Map<string, number>()
  for (const g of invGroups) {
    inventoryMap.set(pgKey(g.productId, g.gradeId), g._sum.qty ?? 0)
  }

  // 2. Pending Amazon MFN order quantities by sellerSku
  //    These orders haven't been processed yet (no inventory reservation),
  //    so their qty isn't reflected in on-hand. Must subtract to prevent oversales.
  const pendingMap = new Map<string, number>()
  if (amazonSkus.length > 0) {
    const pendingGroups = await prisma.orderItem.groupBy({
      by: ['sellerSku'],
      where: {
        sellerSku: { in: amazonSkus },
        order: {
          fulfillmentChannel: 'MFN',
          orderSource: 'amazon',
          workflowStatus: 'PENDING',
        },
      },
      _sum: { quantityOrdered: true, quantityShipped: true },
    })
    for (const g of pendingGroups) {
      if (g.sellerSku) {
        pendingMap.set(g.sellerSku, (g._sum.quantityOrdered ?? 0) - (g._sum.quantityShipped ?? 0))
      }
    }
  }

  // 3. Wholesale soft-reserved qty by product+grade (PROCESSING only, finished-goods)
  const whGroups = await prisma.salesOrderInventoryReservation.groupBy({
    by: ['productId', 'gradeId'],
    where: {
      productId: { in: productIds },
      location: { isFinishedGoods: true },
      salesOrder: { fulfillmentStatus: { in: ['PROCESSING'] } },
    },
    _sum: { qtyReserved: true },
  })
  const wholesaleMap = new Map<string, number>()
  for (const g of whGroups) {
    wholesaleMap.set(pgKey(g.productId, g.gradeId), g._sum.qtyReserved ?? 0)
  }

  // 4. Current Amazon listing quantities (for skip-if-unchanged fallback)
  const listings = await prisma.sellerListing.findMany({
    where: { sku: { in: allSkus } },
    select: { sku: true, accountId: true, quantity: true },
  })
  const listingQtyMap = new Map<string, number>()
  for (const l of listings) {
    listingQtyMap.set(`${l.sku}::${l.accountId}`, l.quantity)
  }

  return { inventoryMap, pendingMap, wholesaleMap, listingQtyMap }
}

// ─── Split qty evenly across a group of SKUs ─────────────────────────────────

export function splitQtyForGroup(available: number, count: number): number[] {
  if (count === 0) return []
  if (count === 1) return [available]
  const base = Math.floor(available / count)
  const remainder = available % count
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0))
}

// ─── Compute available qty for a product+grade group ─────────────────────────

function computeGroupAvailable(
  mskus: { productId: string; gradeId: string | null; marketplace: string; sellerSku: string }[],
  bulk: BulkQuantities,
): number {
  const key = pgKey(mskus[0].productId, mskus[0].gradeId)
  const onHand = bulk.inventoryMap.get(key) ?? 0
  // Pending orders are per-sellerSku — sum across all SKUs in the group
  const pendingQty = mskus.reduce((sum, m) => {
    return sum + (m.marketplace === 'amazon' ? (bulk.pendingMap.get(m.sellerSku) ?? 0) : 0)
  }, 0)
  const wholesaleQty = bulk.wholesaleMap.get(key) ?? 0
  return Math.max(0, onHand - pendingQty - wholesaleQty)
}

// ─── Compute per-MSKU quantities for a group (with split + buffer + maxQty) ──

interface GroupMsku {
  id: string
  productId: string
  gradeId: string | null
  marketplace: string
  sellerSku: string
  maxQty: number | null
  isDefaultSku: boolean
  createdAt: Date
}

export function calculateGroupQuantities(
  mskus: GroupMsku[],
  bulk: BulkQuantities,
): Map<string, number> {
  const result = new Map<string, number>()
  if (mskus.length === 0) return result

  const available = computeGroupAvailable(mskus, bulk)

  // Find the default SKU: explicit isDefaultSku flag, else earliest createdAt
  const defaultIdx = mskus.findIndex(m => m.isDefaultSku)
  const bufferIdx = defaultIdx >= 0 ? defaultIdx : mskus.reduce((best, m, i) =>
    m.createdAt < mskus[best].createdAt ? i : best, 0)

  // Group-level low-stock buffer: if available ≤3 && >0, push 1 to default SKU, 0 to rest
  if (available > 0 && available <= 3) {
    for (let i = 0; i < mskus.length; i++) {
      const allocated = i === bufferIdx ? 1 : 0
      const finalQty = mskus[i].maxQty != null ? Math.min(allocated, mskus[i].maxQty!) : allocated
      result.set(mskus[i].id, finalQty)
    }
    return result
  }

  // Even split
  const allocations = splitQtyForGroup(available, mskus.length)
  for (let i = 0; i < mskus.length; i++) {
    const finalQty = mskus[i].maxQty != null ? Math.min(allocations[i], mskus[i].maxQty!) : allocations[i]
    result.set(mskus[i].id, finalQty)
  }
  return result
}

// ─── Back Market client init ────────────────────────────────────────────────

export async function getBmContext(mskus: MskuWithRelations[]) {
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

// ─── Bulk push (cron) — rock-solid implementation ───────────────────────────

export async function pushAllQuantities(): Promise<{ results: PushResult[] }> {
  const startTime = Date.now()

  // 1. Load all enabled MSKUs with relations
  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: { syncQty: true },
    include: {
      product: { select: { id: true, sku: true } },
      grade: { select: { id: true, grade: true } },
      marketplaceListing: { select: { fulfillmentChannel: true } },
    },
  })

  if (mskus.length === 0) return { results: [] }

  // 2. Filter out FBA SKUs — Amazon manages FBA inventory
  const filteredMskus = mskus.filter(m => m.marketplaceListing?.fulfillmentChannel !== 'FBA')
  console.log(`[push-qty] ${filteredMskus.length} MFN SKUs to process (${mskus.length - filteredMskus.length} FBA skipped)`)

  // 3. Sort by stale-first using lastPushedAt (least-recently-pushed first)
  filteredMskus.sort((a, b) => {
    const aTime = a.lastPushedAt?.getTime() ?? 0
    const bTime = b.lastPushedAt?.getTime() ?? 0
    return aTime - bTime
  })

  // 4. Bulk compute all quantities in 4 DB queries (instead of ~1600 per-SKU queries)
  const bulk = await computeBulkQuantities(filteredMskus)
  const bulkTime = Date.now() - startTime
  console.log(`[push-qty] Bulk quantities computed in ${bulkTime}ms`)

  // 5. Init Back Market context if any BM SKUs
  const { bmClient, bmListingsCache } = await getBmContext(filteredMskus)

  // 6. Resolve default Amazon account ID once
  let defaultAccountId: string | null = null

  // 7. Pre-load cached productTypes from seller_listings (avoids per-SKU GET)
  const amazonSkus = filteredMskus.filter(m => m.marketplace === 'amazon').map(m => m.sellerSku)
  const productTypeCache = new Map<string, string>()
  if (amazonSkus.length > 0) {
    const listings = await prisma.sellerListing.findMany({
      where: { sku: { in: amazonSkus }, productType: { not: null } },
      select: { sku: true, productType: true },
    })
    for (const l of listings) {
      if (l.productType) productTypeCache.set(l.sku, l.productType)
    }
    console.log(`[push-qty] productType cache: ${productTypeCache.size}/${amazonSkus.length} cached`)
  }

  // 8. Group MSKUs by (productId, gradeId) and compute split quantities
  const groups = new Map<string, typeof filteredMskus>()
  for (const msku of filteredMskus) {
    const key = pgKey(msku.productId, msku.gradeId)
    const group = groups.get(key)
    if (group) group.push(msku)
    else groups.set(key, [msku])
  }

  // Compute per-MSKU quantities using group-aware split
  const qtyMap = new Map<string, number>()
  groups.forEach(group => {
    const groupQtys = calculateGroupQuantities(group, bulk)
    groupQtys.forEach((qty, id) => qtyMap.set(id, qty))
  })

  // Build work queue — filter out skipped SKUs
  interface WorkItem {
    msku: typeof filteredMskus[0]
    finalQty: number
  }
  const workQueue: WorkItem[] = []
  const results: PushResult[] = []
  let skipped = 0

  for (const msku of filteredMskus) {
    const finalQty = qtyMap.get(msku.id) ?? 0

    // Skip if unchanged — unless stale (>6h since last push) to catch Amazon-side drift
    if (msku.lastPushedQty === finalQty) {
      const hoursSinceLastPush = msku.lastPushedAt
        ? (Date.now() - msku.lastPushedAt.getTime()) / 3_600_000
        : Infinity
      if (hoursSinceLastPush < 6) {
        skipped++
        results.push({ sellerSku: msku.sellerSku, marketplace: msku.marketplace, quantity: finalQty })
        continue
      }
    }

    workQueue.push({ msku, finalQty })
  }

  console.log(`[push-qty] ${workQueue.length} to push, ${skipped} skipped (unchanged)`)

  // 9. Split work into Amazon (batched via Feeds API) and Back Market (individual API calls)
  let pushed = 0
  let errors = 0

  const amazonWork = workQueue.filter(w => w.msku.marketplace === 'amazon')
  const bmWork = workQueue.filter(w => w.msku.marketplace === 'backmarket')

  // 9a. Amazon — submit a single inventory feed for all SKUs (reliable, no silent drops)
  if (amazonWork.length > 0) {
    const accountId = amazonWork[0].msku.accountId ?? defaultAccountId ?? await (async () => {
      const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
      if (!account) throw new Error('No active Amazon account found')
      defaultAccountId = account.id
      return account.id
    })()

    try {
      const feedUpdates = amazonWork.map(w => ({ sku: w.msku.sellerSku, quantity: w.finalQty }))
      const feedId = await submitInventoryFeed(accountId, feedUpdates)
      console.log(`[push-qty] Inventory feed submitted: feedId=${feedId}, ${feedUpdates.length} SKU(s)`)

      // Mark all as pushed
      for (const { msku, finalQty } of amazonWork) {
        pushed++
        results.push({ sellerSku: msku.sellerSku, marketplace: msku.marketplace, quantity: finalQty })
        await prisma.productGradeMarketplaceSku.update({
          where: { id: msku.id },
          data: { lastPushedQty: finalQty, lastPushedAt: new Date() },
        }).catch(() => {})
        // Mirror qty in seller_listings
        await prisma.sellerListing.updateMany({
          where: { sku: msku.sellerSku },
          data: { quantity: finalQty, updatedAt: new Date() },
        }).catch(() => {})
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[push-qty] Feed submission failed: ${msg}`)
      for (const { msku } of amazonWork) {
        errors++
        results.push({ sellerSku: msku.sellerSku, marketplace: msku.marketplace, quantity: -1, error: msg })
      }
    }
  }

  // 9b. Back Market — individual API calls in batches of 5
  const BM_BATCH_SIZE = 5
  for (let i = 0; i < bmWork.length; i += BM_BATCH_SIZE) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      console.log(`[push-qty] Timeout approaching after ${pushed} pushed, ${errors} errors — ${bmWork.length - i} BM remaining`)
      break
    }
    const batch = bmWork.slice(i, i + BM_BATCH_SIZE)
    const batchResults = await Promise.allSettled(
      batch.map(async ({ msku, finalQty }) => {
        if (!bmClient || !bmListingsCache) throw new Error('No active Back Market credentials')
        const listingId = bmListingsCache.get(msku.sellerSku)
        if (!listingId) throw new Error(`BM listing not found for SKU ${msku.sellerSku}`)
        await bmClient.updateListingQuantity(listingId, finalQty)
        return { msku, finalQty }
      }),
    )
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        const { msku, finalQty } = result.value
        pushed++
        results.push({ sellerSku: msku.sellerSku, marketplace: msku.marketplace, quantity: finalQty })
        await prisma.productGradeMarketplaceSku.update({
          where: { id: msku.id },
          data: { lastPushedQty: finalQty, lastPushedAt: new Date() },
        }).catch(() => {})
      } else {
        const msku = batch[batchResults.indexOf(result)].msku
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
        console.error(`[push-qty] Failed BM for ${msku.sellerSku}: ${msg}`)
        errors++
        results.push({ sellerSku: msku.sellerSku, marketplace: msku.marketplace, quantity: -1, error: msg })
      }
    }
  }

  const totalElapsed = Date.now() - startTime
  console.log(
    `[push-qty] Done in ${totalElapsed}ms — pushed=${pushed} skipped=${skipped} errors=${errors} total=${filteredMskus.length}`
  )

  return { results }
}

// ─── Single MSKU push by ID (used when toggling syncQty on) ─────────────────
// Now pushes ALL siblings in the same (productId, gradeId) group so the split is correct.

export async function pushSingleQuantity(mskuId: string): Promise<PushResult> {
  const msku = await prisma.productGradeMarketplaceSku.findUniqueOrThrow({
    where: { id: mskuId },
    include: {
      product: { select: { id: true, sku: true } },
      grade: { select: { id: true, grade: true } },
      marketplaceListing: { select: { fulfillmentChannel: true } },
    },
  })

  // Skip FBA SKUs — Amazon manages FBA inventory
  if ((msku as typeof msku & { marketplaceListing?: { fulfillmentChannel: string | null } | null }).marketplaceListing?.fulfillmentChannel === 'FBA') {
    return { sellerSku: msku.sellerSku, marketplace: msku.marketplace, quantity: -1, error: 'FBA inventory is managed by Amazon' }
  }

  // Find all active-push siblings in the same (productId, gradeId) group
  const siblings = await prisma.productGradeMarketplaceSku.findMany({
    where: {
      productId: msku.productId,
      gradeId: msku.gradeId ?? null,
      syncQty: true,
    },
    include: {
      product: { select: { id: true, sku: true } },
      grade: { select: { id: true, grade: true } },
      marketplaceListing: { select: { fulfillmentChannel: true } },
    },
  })

  // Filter out FBA siblings
  const group = siblings.filter(m => m.marketplaceListing?.fulfillmentChannel !== 'FBA')
  if (group.length === 0) {
    return { sellerSku: msku.sellerSku, marketplace: msku.marketplace, quantity: 0 }
  }

  // Compute split quantities for the whole group
  const bulk = await computeBulkQuantities(group)
  const qtyMap = calculateGroupQuantities(group, bulk)

  // Push all siblings (not just the toggled one) so they all get correct split
  const { bmClient, bmListingsCache } = await getBmContext(group)
  let targetResult: PushResult | null = null

  // Batch Amazon siblings into a single feed submission
  const amazonSiblings = group.filter(s => s.marketplace === 'amazon')
  const bmSiblings = group.filter(s => s.marketplace === 'backmarket')

  if (amazonSiblings.length > 0) {
    const accountId = amazonSiblings[0].accountId ?? (await prisma.amazonAccount.findFirst({ where: { isActive: true } }))?.id
    if (!accountId) throw new Error('No active Amazon account found')
    try {
      const feedUpdates = amazonSiblings.map(s => ({ sku: s.sellerSku, quantity: qtyMap.get(s.id) ?? 0 }))
      await submitInventoryFeed(accountId, feedUpdates)
      for (const sibling of amazonSiblings) {
        const finalQty = qtyMap.get(sibling.id) ?? 0
        await prisma.productGradeMarketplaceSku.update({
          where: { id: sibling.id },
          data: { lastPushedQty: finalQty, lastPushedAt: new Date() },
        }).catch(() => {})
        await prisma.sellerListing.updateMany({
          where: { sku: sibling.sellerSku },
          data: { quantity: finalQty, updatedAt: new Date() },
        }).catch(() => {})
        if (sibling.id === mskuId) {
          targetResult = { sellerSku: sibling.sellerSku, marketplace: sibling.marketplace, quantity: finalQty }
        }
      }
    } catch (err) {
      console.error(`[push-qty] Feed submission failed for single push:`, err instanceof Error ? err.message : err)
      for (const sibling of amazonSiblings) {
        if (sibling.id === mskuId) {
          targetResult = { sellerSku: sibling.sellerSku, marketplace: sibling.marketplace, quantity: -1, error: err instanceof Error ? err.message : String(err) }
        }
      }
    }
  }

  for (const sibling of bmSiblings) {
    const finalQty = qtyMap.get(sibling.id) ?? 0
    try {
      if (!bmClient || !bmListingsCache) throw new Error('No active Back Market credentials')
      const listingId = bmListingsCache.get(sibling.sellerSku)
      if (!listingId) throw new Error(`BM listing not found for SKU ${sibling.sellerSku}`)
      await bmClient.updateListingQuantity(listingId, finalQty)
      await prisma.productGradeMarketplaceSku.update({
        where: { id: sibling.id },
        data: { lastPushedQty: finalQty, lastPushedAt: new Date() },
      }).catch(() => {})
      if (sibling.id === mskuId) {
        targetResult = { sellerSku: sibling.sellerSku, marketplace: sibling.marketplace, quantity: finalQty }
      }
    } catch (err) {
      console.error(`[push-qty] Failed BM sibling push for ${sibling.sellerSku}:`, err instanceof Error ? err.message : err)
      if (sibling.id === mskuId) {
        targetResult = { sellerSku: sibling.sellerSku, marketplace: sibling.marketplace, quantity: -1, error: err instanceof Error ? err.message : String(err) }
      }
    }
  }

  return targetResult ?? { sellerSku: msku.sellerSku, marketplace: msku.marketplace, quantity: qtyMap.get(msku.id) ?? 0 }
}

// ─── HTTP handler ───────────────────────────────────────────────────────────

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
    const { results } = await pushAllQuantities()
    const pushed = results.filter((r) => !r.error)
    const errored = results.filter((r) => r.error)
    return NextResponse.json({ pushed, errors: errored, total: results.length })
  } catch (err) {
    console.error('[push-qty]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Push failed' },
      { status: 500 },
    )
  }
}
