/**
 * POST /api/orders/check-cancellations
 * Body: { accountId: string }
 *
 * Fetches all active MFN orders (Pending + Unshipped + PartiallyShipped) from
 * SP-API and checks the IsBuyerRequestedCancel flag on each.  Updates the
 * internal order records and returns the list of flagged orders.
 *
 * Uses the GetOrders list endpoint (single/few API calls) rather than calling
 * GetOrder per-order, so the whole check completes within the burst window for
 * most sellers.
 *
 * Rate limits: GetOrders burst 20, then 0.0167 req/s (65 s/page after burst)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'
import { requireAdmin, requireActiveAccount } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

const PAGE_BURST    = 20
const PAGE_SLEEP_MS = 65_000

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

interface SpOrder {
  AmazonOrderId?: string
  IsBuyerRequestedCancel?: boolean
  BuyerRequestedCancelReason?: string
}

interface GetOrdersResp {
  payload?: { Orders?: SpOrder[]; NextToken?: string }
  errors?: { code: string; message: string }[]
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const adminErr = requireAdmin(user)
    if (adminErr) return adminErr

    const { accountId } = await req.json()
    if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

    const accountOrErr = await requireActiveAccount(accountId)
    if (accountOrErr instanceof NextResponse) return accountOrErr
    const account = accountOrErr

    const client = new SpApiClient(accountId)
    const createdAfter = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

    // Pull all Pending + Unshipped + PartiallyShipped MFN orders from SP-API
    const allOrders: SpOrder[] = []
    let nextToken: string | undefined
    let pagesFetched = 0

    do {
      const params: Record<string, string> = {
        MarketplaceIds:      account.marketplaceId,
        OrderStatuses:       'Pending,Unshipped,PartiallyShipped',
        FulfillmentChannels: 'MFN',
        CreatedAfter:        createdAfter,
        MaxResultsPerPage:   '100',
      }
      if (nextToken) params.NextToken = nextToken

      const resp = await client.get<GetOrdersResp>('/orders/v0/orders', params)
      pagesFetched++

      if (resp?.errors?.length) {
        const msg = resp.errors.map(e => `${e.code}: ${e.message}`).join('; ')
        return NextResponse.json({ error: `SP-API error: ${msg}` }, { status: 502 })
      }

      allOrders.push(...(resp?.payload?.Orders ?? []))
      nextToken = resp?.payload?.NextToken
      if (nextToken && pagesFetched >= PAGE_BURST) await sleep(PAGE_SLEEP_MS)
    } while (nextToken)

    // Split into flagged vs non-flagged
    const flagged    = allOrders.filter(o => o.IsBuyerRequestedCancel === true && o.AmazonOrderId)
    const flaggedIds = new Set(flagged.map(o => o.AmazonOrderId!))
    const allIds     = allOrders.map(o => o.AmazonOrderId!).filter(Boolean)

    // Mark orders with an active cancellation request
    if (flagged.length > 0) {
      await Promise.all(
        flagged.map(o =>
          prisma.order.updateMany({
            where: { accountId, amazonOrderId: o.AmazonOrderId! },
            data: {
              isBuyerRequestedCancel: true,
              buyerCancelReason: o.BuyerRequestedCancelReason ?? null,
            },
          }),
        ),
      )
    }

    // Clear the flag on orders that SP-API no longer reports as flagged.
    // Compute the difference manually — Prisma doesn't support combining
    // `in` and `notIn` on the same field in a single filter object.
    const unflaggedIds = allIds.filter(id => !flaggedIds.has(id))
    if (unflaggedIds.length > 0) {
      await prisma.order.updateMany({
        where: {
          accountId,
          isBuyerRequestedCancel: true,
          amazonOrderId: { in: unflaggedIds },
        },
        data: { isBuyerRequestedCancel: false, buyerCancelReason: null },
      })
    }

    // Return the currently-flagged orders from DB
    const flaggedOrders = await prisma.order.findMany({
      where: { accountId, isBuyerRequestedCancel: true },
      select: {
        id: true,
        amazonOrderId: true,
        olmNumber: true,
        buyerCancelReason: true,
        workflowStatus: true,
      },
      orderBy: { purchaseDate: 'desc' },
    })

    return NextResponse.json({
      checked: allOrders.length,
      flagged: flaggedOrders,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[check-cancellations]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
