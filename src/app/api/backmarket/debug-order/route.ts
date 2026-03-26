/**
 * Debug endpoint: fetches raw BackMarket order data to inspect available fields.
 * GET /api/backmarket/debug-order?orderId=12345
 *
 * Returns the raw JSON from BackMarket's API so we can see commission/fee fields.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from '@/lib/backmarket/client'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const orderId = searchParams.get('orderId')

  try {
    const credential = await prisma.backMarketCredential.findFirst({
      where: { isActive: true },
      select: { apiKeyEnc: true },
    })
    if (!credential) return NextResponse.json({ error: 'No BM credential' }, { status: 500 })

    const client = new BackMarketClient(decrypt(credential.apiKeyEnc))

    if (orderId) {
      // Fetch a single order by its BM order_id
      const raw = await client.get<unknown>(`/orders/${orderId}`)
      return NextResponse.json({ singleOrder: raw })
    }

    // Otherwise fetch the first page of shipped orders (state 3) — just first page
    const raw = await client.get<unknown>('/orders', { state: 3 })
    return NextResponse.json({ ordersPage1: raw })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
