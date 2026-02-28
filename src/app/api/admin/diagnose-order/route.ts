/**
 * GET /api/admin/diagnose-order?orderId=XXX
 * Returns the raw Orders API response (or error) for a given order ID.
 * Protected by CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orderId = req.nextUrl.searchParams.get('orderId')
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return NextResponse.json({ error: 'No active account' }, { status: 400 })

  const client = new SpApiClient(account.id)

  try {
    const resp = await client.get<unknown>(`/orders/v0/orders/${orderId}`)
    return NextResponse.json({ ok: true, orderId, response: resp })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, orderId, error: msg })
  }
}
