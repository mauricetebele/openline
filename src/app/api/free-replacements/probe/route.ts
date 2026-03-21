import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { probeOrder } from '@/lib/amazon/sync-replacements'

/**
 * GET /api/free-replacements/probe?orderId=113-1141718-0565010
 * Fetches a single order from SP-API and returns all its fields for debugging.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orderId = req.nextUrl.searchParams.get('orderId')
  if (!orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 })

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return NextResponse.json({ error: 'No active account' }, { status: 400 })

  const order = await probeOrder(account.id, orderId)

  return NextResponse.json({ orderId, order })
}
