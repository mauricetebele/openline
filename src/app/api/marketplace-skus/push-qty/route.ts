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
import { updateListingQuantity as updateAmazonQty } from '@/lib/amazon/listings'
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
}

async function computeBulkQuantities(mskus: MskuWithRelations[]): Promise<BulkQuantities> {
  const productIds = Array.from(new Set(mskus.map(m => m.productId)))
  const amazonSkus = Array.from(new Set(mskus.filter(m => m.marketplace === 'amazon').map(m => m.sellerSku)))

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

  return { inventoryMap, pendingMap, wholesaleMap }
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

const SEESAW_INTERVAL_MS = 12 * 60 * 60 * 1000

interface GroupMsku {
  id: string
  productId: string
  gradeId: string | null
  marketplace: string
  sellerSku: string
  maxQty: number | null
  isDefaultSku: boolean
  seeSaw: boolean
  seeSawActive: boolean
  seeSawFlippedAt: Date | null
  createdAt: Date
}

export interface SeeSawFlip { id: string; seeSawActive: boolean; seeSawFlippedAt: Date | null }

/**
 * Pick the recipient of the single last-unit buffer allocation, and advance the
 * SEE-SAW rotation if 12h have elapsed. Precedence:
 *   1. Last Unit Lean (isDefaultSku) — fixed marketplace, no rotation.
 *   2. SEE-SAW (seeSaw participants) — alternates the recipient every 12h.
 *   3. Legacy fallback — earliest-created SKU.
 * Returns the recipient index into `mskus` plus any rotation-state changes to persist.
 */
function pickBufferRecipient(
  mskus: GroupMsku[],
  now: number,
): { recipientIdx: number; flips: SeeSawFlip[] } {
  const flips: SeeSawFlip[] = []

  // 1. Last Unit Lean wins if set.
  const leanIdx = mskus.findIndex(m => m.isDefaultSku)
  if (leanIdx >= 0) return { recipientIdx: leanIdx, flips }

  // 2. SEE-SAW: rotate among participants deterministically.
  const participants = mskus
    .map((m, i) => ({ m, i }))
    .filter(x => x.m.seeSaw)
    .sort((a, b) => a.m.marketplace.localeCompare(b.m.marketplace) || a.m.sellerSku.localeCompare(b.m.sellerSku))

  if (participants.length === 0) {
    // 3. Legacy fallback — earliest createdAt.
    const idx = mskus.reduce((best, m, i) => (m.createdAt < mskus[best].createdAt ? i : best), 0)
    return { recipientIdx: idx, flips }
  }

  let activePos = participants.findIndex(p => p.m.seeSawActive)
  const flippedAt = activePos >= 0 ? participants[activePos].m.seeSawFlippedAt?.getTime() ?? null : null

  if (activePos < 0) {
    activePos = 0
    flips.push({ id: participants[0].m.id, seeSawActive: true, seeSawFlippedAt: new Date(now) })
  } else if (flippedAt == null) {
    // Active but never timestamped — stamp now, don't advance yet.
    flips.push({ id: participants[activePos].m.id, seeSawActive: true, seeSawFlippedAt: new Date(now) })
  } else if (now - flippedAt >= SEESAW_INTERVAL_MS) {
    const nextPos = (activePos + 1) % participants.length
    if (nextPos !== activePos) {
      flips.push({ id: participants[activePos].m.id, seeSawActive: false, seeSawFlippedAt: null })
    }
    flips.push({ id: participants[nextPos].m.id, seeSawActive: true, seeSawFlippedAt: new Date(now) })
    activePos = nextPos
  }

  return { recipientIdx: participants[activePos].i, flips }
}

/**
 * Per-MSKU quantities for a (productId, gradeId) group. Plenty of stock → even
 * split across marketplaces. Last-unit buffer (available 1–3) → a single unit to
 * one marketplace, chosen by Last Unit Lean or the SEE-SAW rotation (see
 * pickBufferRecipient). Returns quantities plus any SEE-SAW state changes to persist.
 */
export function calculateGroupQuantities(
  mskus: GroupMsku[],
  bulk: BulkQuantities,
  now: number,
): { qtys: Map<string, number>; flips: SeeSawFlip[] } {
  const qtys = new Map<string, number>()
  if (mskus.length === 0) return { qtys, flips: [] }

  const available = computeGroupAvailable(mskus, bulk)

  // Low-stock buffer: push 1 unit to a single marketplace, 0 to the rest.
  if (available > 0 && available <= 3) {
    const { recipientIdx, flips } = pickBufferRecipient(mskus, now)
    for (let i = 0; i < mskus.length; i++) {
      const allocated = i === recipientIdx ? 1 : 0
      const finalQty = mskus[i].maxQty != null ? Math.min(allocated, mskus[i].maxQty!) : allocated
      qtys.set(mskus[i].id, finalQty)
    }
    return { qtys, flips }
  }

  // Even split (see-saw not applicable when there's more than the buffer).
  const allocations = splitQtyForGroup(available, mskus.length)
  for (let i = 0; i < mskus.length; i++) {
    const finalQty = mskus[i].maxQty != null ? Math.min(allocations[i], mskus[i].maxQty!) : allocations[i]
    qtys.set(mskus[i].id, finalQty)
  }
  return { qtys, flips: [] }
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

  // Compute per-MSKU quantities using group-aware split (+ see-saw rotation)
  const qtyMap = new Map<string, number>()
  const seeSawFlips: SeeSawFlip[] = []
  const nowMs = Date.now()
  groups.forEach(group => {
    const { qtys, flips } = calculateGroupQuantities(group, bulk, nowMs)
    qtys.forEach((qty, id) => qtyMap.set(id, qty))
    if (flips.length) seeSawFlips.push(...flips)
  })

  // Persist see-saw rotation changes (active side + flip timestamp) before pushing.
  for (const f of seeSawFlips) {
    await prisma.productGradeMarketplaceSku.update({
      where: { id: f.id },
      data: { seeSawActive: f.seeSawActive, seeSawFlippedAt: f.seeSawFlippedAt },
    }).catch(() => {})
  }

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

  // 9. Push in parallel batches of 5 (respects SP-API rate limit ~5 req/s)
  let pushed = 0
  let errors = 0
  const BATCH_SIZE = 5

  for (let i = 0; i < workQueue.length; i += BATCH_SIZE) {
    // Timeout guard
    if (Date.now() - startTime > TIMEOUT_MS) {
      console.log(`[push-qty] Timeout approaching after ${pushed} pushed, ${errors} errors — ${workQueue.length - i} remaining`)
      break
    }

    const batch = workQueue.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.allSettled(
      batch.map(async ({ msku, finalQty }) => {
        if (msku.marketplace === 'amazon') {
          const accountId = msku.accountId ?? defaultAccountId ?? await (async () => {
            const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
            if (!account) throw new Error('No active Amazon account found')
            defaultAccountId = account.id
            return account.id
          })()
          const cachedPT = productTypeCache.get(msku.sellerSku)
          const usedPT = await updateAmazonQty(accountId, msku.sellerSku, finalQty, cachedPT)
          // Cache the discovered productType for future runs
          if (!cachedPT && usedPT) productTypeCache.set(msku.sellerSku, usedPT)
        } else if (msku.marketplace === 'backmarket') {
          if (!bmClient || !bmListingsCache) throw new Error('No active Back Market credentials')
          const listingId = bmListingsCache.get(msku.sellerSku)
          if (!listingId) throw new Error(`BM listing not found for SKU ${msku.sellerSku}`)
          await bmClient.updateListingQuantity(listingId, finalQty)
        }
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
        console.error(`[push-qty] Failed for ${msku.sellerSku}: ${msg}`)
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

  // Compute split quantities for the whole group (+ see-saw rotation)
  const bulk = await computeBulkQuantities(group)
  const { qtys: qtyMap, flips } = calculateGroupQuantities(group, bulk, Date.now())
  for (const f of flips) {
    await prisma.productGradeMarketplaceSku.update({
      where: { id: f.id },
      data: { seeSawActive: f.seeSawActive, seeSawFlippedAt: f.seeSawFlippedAt },
    }).catch(() => {})
  }

  // Push all siblings (not just the toggled one) so they all get correct split
  const { bmClient, bmListingsCache } = await getBmContext(group)
  let targetResult: PushResult | null = null

  for (const sibling of group) {
    const finalQty = qtyMap.get(sibling.id) ?? 0
    try {
      if (sibling.marketplace === 'amazon') {
        const accountId = sibling.accountId ?? (await prisma.amazonAccount.findFirst({ where: { isActive: true } }))?.id
        if (!accountId) throw new Error('No active Amazon account found')
        await updateAmazonQty(accountId, sibling.sellerSku, finalQty)
      } else if (sibling.marketplace === 'backmarket') {
        if (!bmClient || !bmListingsCache) throw new Error('No active Back Market credentials')
        const listingId = bmListingsCache.get(sibling.sellerSku)
        if (!listingId) throw new Error(`BM listing not found for SKU ${sibling.sellerSku}`)
        await bmClient.updateListingQuantity(listingId, finalQty)
      }
      await prisma.productGradeMarketplaceSku.update({
        where: { id: sibling.id },
        data: { lastPushedQty: finalQty, lastPushedAt: new Date() },
      }).catch(() => {})
      if (sibling.id === mskuId) {
        targetResult = { sellerSku: sibling.sellerSku, marketplace: sibling.marketplace, quantity: finalQty }
      }
    } catch (err) {
      console.error(`[push-qty] Failed sibling push for ${sibling.sellerSku}:`, err instanceof Error ? err.message : err)
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
