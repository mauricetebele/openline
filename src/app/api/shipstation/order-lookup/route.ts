import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/shipstation/order-lookup?amazonOrderId=111-XXXXXXX-XXXXXXX
 *
 * Searches ShipStation for an order whose orderNumber matches the given Amazon
 * Order ID.  Returns:
 *   { found: true,  ssOrderId: number, orderStatus: string, shipTo: SSAddress }
 *   { found: false, error?: string }
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const amazonOrderId = req.nextUrl.searchParams.get('amazonOrderId')?.trim()
  if (!amazonOrderId) return NextResponse.json({ error: 'Missing amazonOrderId' }, { status: 400 })

  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!account) return NextResponse.json({ error: 'No ShipStation account connected' }, { status: 404 })

  const client = new ShipStationClient(decrypt(account.apiKeyEnc), account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '')

  try {
    const ssOrder = await client.findOrderByNumber(amazonOrderId)
    if (!ssOrder) {
      return NextResponse.json({ found: false })
    }

    // Persist ssOrderId on the local Order record so the grid can show a "synced" badge
    prisma.order.updateMany({
      where: { amazonOrderId, ssOrderId: null },
      data:  { ssOrderId: ssOrder.orderId },
    }).catch(() => {}) // best-effort, don't block the response

    return NextResponse.json({
      found:       true,
      ssOrderId:   ssOrder.orderId,
      orderStatus: ssOrder.orderStatus,
      shipTo:      ssOrder.shipTo,
    })
  } catch (err) {
    return NextResponse.json(
      { found: false, error: err instanceof Error ? err.message : 'Lookup failed' },
      { status: 502 },
    )
  }
}
