/**
 * GET /api/backmarket/order-lookup?orderId=71812700
 *
 * Debug endpoint: fetches a specific order directly from BackMarket API
 * to see what state it's in and why it might not appear in list queries.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from '@/lib/backmarket/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const orderId = req.nextUrl.searchParams.get('orderId')
  if (!orderId) return NextResponse.json({ error: 'Missing orderId param' }, { status: 400 })

  const credential = await prisma.backMarketCredential.findFirst({
    where: { isActive: true },
    select: { apiKeyEnc: true },
  })
  if (!credential) return NextResponse.json({ error: 'No active BackMarket credential' }, { status: 404 })

  const client = new BackMarketClient(decrypt(credential.apiKeyEnc))

  try {
    const data = await client.get<Record<string, unknown>>(`/orders/${orderId}`)
    return NextResponse.json({ orderId, bmData: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ orderId, error: msg }, { status: 502 })
  }
}
