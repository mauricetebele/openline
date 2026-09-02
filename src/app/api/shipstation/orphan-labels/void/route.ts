/**
 * POST /api/shipstation/orphan-labels/void
 * Body: { shipmentId, trackingNumber?, orderNumber?, cost? }
 *
 * Voids an orphaned ShipStation label (one our system never saved) directly by
 * its ShipStation shipmentId, and records it. On success ShipStation marks the
 * shipment voided, so it drops off the orphan reconciliation on refresh.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'
import { logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const shipmentId = body?.shipmentId
  if (shipmentId == null) return NextResponse.json({ error: 'shipmentId is required' }, { status: 400 })

  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
  })
  if (!account) return NextResponse.json({ error: 'No active ShipStation account connected' }, { status: 404 })

  const client = new ShipStationClient(
    decrypt(account.apiKeyEnc),
    account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '',
    account.v2ApiKeyEnc ? decrypt(account.v2ApiKeyEnc) : null,
  )

  try {
    const result = await client.voidLabel(shipmentId)
    if (!result.approved) {
      return NextResponse.json({ error: `ShipStation declined the void: ${result.message}` }, { status: 422 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Void failed: ${msg}` }, { status: 502 })
  }

  await logAuditEvent({
    entityType: 'orphanLabel',
    entityId: String(shipmentId),
    action: 'voided',
    before: {
      shipmentId,
      trackingNumber: body?.trackingNumber ?? null,
      orderNumber: body?.orderNumber ?? null,
      cost: body?.cost ?? null,
    },
    actorId: user.dbId,
    actorLabel: user.email,
  }).catch(e => console.error('[orphan void] audit failed:', e))

  return NextResponse.json({ success: true })
}
