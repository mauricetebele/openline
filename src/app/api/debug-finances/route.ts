/**
 * GET /api/debug-finances?accountId=XXX&amazonOrderId=YYY
 * Probes SP-API financial events for a specific order to diagnose commission sync issues.
 * Also checks what the sync function would fetch with its current date window.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { SpApiClient } from '@/lib/amazon/sp-api'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const user = await getAuthUser()
  if (!user && !(cronSecret && authHeader === `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accountId = req.nextUrl.searchParams.get('accountId')?.trim()
  const amazonOrderId = req.nextUrl.searchParams.get('amazonOrderId')?.trim()
  if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

  const client = new SpApiClient(accountId)

  // 1. If a specific order ID is provided, use the order-specific endpoint
  if (amazonOrderId) {
    try {
      const resp = await client.get<unknown>(
        `/finances/v0/orders/${amazonOrderId}/financialEvents`, {}
      )
      return NextResponse.json({ endpoint: 'order-specific', amazonOrderId, data: resp })
    } catch (err) {
      return NextResponse.json({
        error: err instanceof Error ? err.message : String(err),
      }, { status: 502 })
    }
  }

  // 2. Otherwise, show what the sync window fetches (first page only)
  const end = new Date(Date.now() - 5 * 60 * 1000)
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000)

  try {
    const resp = await client.get<unknown>('/finances/v0/financialEvents', {
      PostedAfter: start.toISOString(),
      PostedBefore: end.toISOString(),
      MaxResultsPerPage: '10',
    })
    return NextResponse.json({
      endpoint: 'bulk-window',
      window: { start: start.toISOString(), end: end.toISOString() },
      data: resp,
    })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 502 })
  }
}
