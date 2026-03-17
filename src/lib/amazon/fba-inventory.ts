/**
 * FBA Inventory sync — fetches fulfillable quantities for all FBA SKUs using
 * the SP-API FBA Inventory v1 endpoint and updates the quantity field on the
 * corresponding SellerListing rows.
 *
 * Endpoint: GET /fba/inventory/v1/summaries
 * Rate limit: 2 req/s  →  500 ms between pages
 *
 * Requires the "FBA Inventory" role on the SP-API application. If the account
 * gets a 403, add the role in Seller Central → Apps & Services → Develop Apps
 * and re-authorize.
 *
 * Called fire-and-forget after each catalog sync (see listings.ts).
 */
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── SP-API response types ────────────────────────────────────────────────────

interface InventorySummary {
  sellerSku?: string
  fnSku?: string
  asin?: string
  inventoryDetails?: {
    fulfillableQuantity?: number
  }
  totalQuantity?: number
}

interface InventorySummariesResponse {
  pagination?: { nextToken?: string }
  payload?: {
    inventorySummaries?: InventorySummary[]
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function syncFbaInventory(accountId: string): Promise<{ updated: number; total: number }> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)

  const inventoryMap = new Map<string, { qty: number; fnsku?: string; asin?: string }>() // SKU → data
  let nextToken: string | undefined
  let page = 0

  do {
    page++
    const params: Record<string, string> = {
      granularityType: 'Marketplace',
      granularityId: account.marketplaceId,
      marketplaceIds: account.marketplaceId,
      details: 'true',
    }
    if (nextToken) params.nextToken = nextToken

    try {
      const response = await client.get<InventorySummariesResponse>(
        '/fba/inventory/v1/summaries',
        params,
      )

      const summaries = response?.payload?.inventorySummaries ?? []
      for (const item of summaries) {
        if (!item.sellerSku) continue
        // fulfillableQuantity is the count available to ship to customers
        const qty = item.inventoryDetails?.fulfillableQuantity ?? item.totalQuantity ?? 0
        inventoryMap.set(item.sellerSku, { qty, fnsku: item.fnSku, asin: item.asin })
      }

      nextToken = response?.pagination?.nextToken
      if (nextToken) await sleep(500) // stay within 2 req/s
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('403')) {
        console.error(
          '[FbaInventory] 403 — the SP-API application is missing the FBA Inventory role. ' +
          'Add it in Seller Central and re-authorize.',
        )
        return { updated: 0, total: 0 }
      }
      console.error(`[FbaInventory] Error on page ${page}: ${msg}`)
      return { updated: 0, total: 0 }
    }
  } while (nextToken)

  if (inventoryMap.size === 0) {
    console.log('[FbaInventory] No FBA inventory found')
    return { updated: 0, total: 0 }
  }

  console.log(`[FbaInventory] Updating ${inventoryMap.size} FBA SKU quantities`)

  // Bulk-update all FBA listings with their fresh fulfillable quantities + FNSKU/ASIN
  let updated = 0
  for (const [sku, { qty: quantity, fnsku, asin }] of Array.from(inventoryMap.entries())) {
    const result = await prisma.sellerListing.updateMany({
      where: { accountId, sku, fulfillmentChannel: 'FBA' },
      data: { quantity, ...(fnsku ? { fnsku } : {}), ...(asin ? { asin } : {}) },
    })
    updated += result.count
  }

  console.log(`[FbaInventory] Done — ${updated} FBA listings updated`)
  return { updated, total: inventoryMap.size }
}
