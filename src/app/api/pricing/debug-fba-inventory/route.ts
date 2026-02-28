/**
 * GET /api/pricing/debug-fba-inventory?accountId=
 *
 * Debug endpoint — calls the FBA Inventory API and returns the raw first page
 * so you can see exactly what is (or isn't) being returned.
 * Remove or restrict before going to production.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = req.nextUrl.searchParams.get('accountId')?.trim()
  if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

  const account = await prisma.amazonAccount.findUnique({ where: { id: accountId } })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const client = new SpApiClient(accountId)

  try {
    const response = await client.get(
      '/fba/inventory/v1/summaries',
      {
        granularityType: 'Marketplace',
        granularityId: account.marketplaceId,
        marketplaceIds: account.marketplaceId,
        details: 'true',
      },
    )

    // Show first 10 items with their quantities
    const payload = (response as Record<string, unknown>)?.payload as Record<string, unknown> | undefined
    const summaries = (payload?.inventorySummaries as unknown[]) ?? []
    const sample = summaries.slice(0, 10)

    return NextResponse.json({
      marketplaceId: account.marketplaceId,
      totalReturned: summaries.length,
      hasNextToken: !!((response as Record<string, unknown>)?.pagination as Record<string, unknown>)?.nextToken,
      sample,
      rawPaginationKeys: Object.keys((response as Record<string, unknown>)?.pagination ?? {}),
      rawPayloadKeys: Object.keys(payload ?? {}),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
