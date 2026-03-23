/**
 * GET /api/orders/debug-lookup?amazonOrderId=XXX&accountId=YYY
 * Directly queries SP-API for a single order to diagnose why it's not syncing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { SpApiClient } from '@/lib/amazon/sp-api'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const amazonOrderId = req.nextUrl.searchParams.get('amazonOrderId')?.trim()
  const accountId = req.nextUrl.searchParams.get('accountId')?.trim()
  if (!amazonOrderId || !accountId) {
    return NextResponse.json({ error: 'Missing amazonOrderId or accountId' }, { status: 400 })
  }

  const client = new SpApiClient(accountId)

  try {
    const resp = await client.get<unknown>(`/orders/v0/orders/${amazonOrderId}`, {})
    return NextResponse.json({ order: resp })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 502 })
  }
}
