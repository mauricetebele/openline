/**
 * Fill missing Amazon product titles on active listings from the Catalog Items
 * API (GET /catalog/2022-04-01/items/{asin}, summaries.itemName). The catalog
 * report leaves item-name blank for many listings; the Repricing Feed shows the
 * title under the ASIN. Catalog Items allows ~2 req/s — paced at 0.6 s.
 */
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'

export async function fillMissingListingTitles(
  accountId: string,
  opts: { budgetMs?: number; max?: number } = {},
): Promise<{ missing: number; filled: number; errors: number }> {
  const started = Date.now()
  const budgetMs = opts.budgetMs ?? 60_000

  const rows = await prisma.sellerListing.findMany({
    where: { accountId, listingStatus: 'Active', asin: { not: null } },
    select: { asin: true, productTitle: true },
  })
  const titled = new Set(rows.filter(r => r.productTitle).map(r => r.asin!))
  const missing = Array.from(new Set(rows.filter(r => !titled.has(r.asin!)).map(r => r.asin!))).slice(0, opts.max ?? 200)
  if (missing.length === 0) return { missing: 0, filled: 0, errors: 0 }

  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)
  let filled = 0, errors = 0
  for (let i = 0; i < missing.length; i++) {
    if (Date.now() - started > budgetMs) break
    if (i > 0) await new Promise(r => setTimeout(r, 600))
    const asin = missing[i]
    try {
      const item = await client.get<{ summaries?: { marketplaceId?: string; itemName?: string }[] }>(
        `/catalog/2022-04-01/items/${asin}`,
        { marketplaceIds: account.marketplaceId, includedData: 'summaries' },
      )
      const title = (item.summaries?.find(s => s.marketplaceId === account.marketplaceId) ?? item.summaries?.[0])?.itemName
      if (title) {
        await prisma.sellerListing.updateMany({ where: { accountId, asin, productTitle: null }, data: { productTitle: title } })
        filled++
      }
    } catch (err) {
      errors++
      if (errors === 1) console.error(`[listing-titles] ${asin}:`, err instanceof Error ? err.message : err)
    }
  }
  return { missing: missing.length, filled, errors }
}
