/**
 * POST /api/repair-orders/[id]/label/void  { direction: 'outbound'|'inbound', force? }
 *
 * Voids the stored shipping label(s) for a repair order's outbound or inbound
 * shipment with the carrier (UPS Direct / FedEx Direct / ShipStation), marks the
 * ReturnLabel rows voided, and clears the tracking off the order so a new label
 * can be created. `force: true` clears even if the carrier void fails (e.g. already
 * voided / past the void window).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { voidReturnLabel } from '@/lib/ups-tracking'
import { loadFedExCredentials, cancelShipment } from '@/lib/fedex/client'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({})) as { direction?: string; force?: boolean }
  const direction = b.direction === 'inbound' ? 'inbound' : 'outbound'
  const force = !!b.force

  const order = await prisma.repairOrder.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, outboundTracking: true, inboundTracking: true },
  })
  if (!order) return NextResponse.json({ error: 'Repair order not found' }, { status: 404 })

  const csv = direction === 'inbound' ? order.inboundTracking : order.outboundTracking
  const nums = (csv ?? '').split(',').map(t => t.trim()).filter(Boolean)
  if (nums.length === 0) return NextResponse.json({ error: `No ${direction} label to void` }, { status: 400 })

  const labels = await prisma.returnLabel.findMany({ where: { trackingNumber: { in: nums } } })
  const active = labels.filter(l => !l.voided)

  // Void each distinct carrier shipment once (UPS/FedEx = 1 shipment; SS = per box).
  let ssClient: ShipStationClient | null = null
  const seen = new Set<string>()
  let carrierError: string | null = null
  for (const l of active) {
    const key = `${l.labelType}:${l.shipmentId}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      if (l.labelType === 'MANUAL_UPS') {
        await voidReturnLabel(l.shipmentId, l.upsCredentialId ?? undefined)
      } else if (l.labelType === 'MANUAL_FEDEX') {
        const creds = await loadFedExCredentials()
        if (!creds) throw new Error('FedEx is not configured')
        await cancelShipment(creds, l.shipmentId)
      } else if (l.labelType === 'MANUAL_SS') {
        if (!ssClient) {
          const acct = await prisma.shipStationAccount.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true } })
          if (!acct) throw new Error('No active ShipStation account')
          ssClient = new ShipStationClient(decrypt(acct.apiKeyEnc), acct.apiSecretEnc ? decrypt(acct.apiSecretEnc) : '', acct.v2ApiKeyEnc ? decrypt(acct.v2ApiKeyEnc) : null)
        }
        await ssClient.voidLabel(l.shipmentId)
      }
    } catch (e) {
      carrierError = e instanceof Error ? e.message : 'Carrier void failed'
    }
  }

  if (carrierError && !force) {
    return NextResponse.json({ error: `Carrier void failed: ${carrierError}` }, { status: 502 })
  }

  // Mark labels voided + clear the order's tracking for this direction.
  await prisma.returnLabel.updateMany({ where: { trackingNumber: { in: nums }, voided: false }, data: { voided: true, voidedAt: new Date() } })

  const revertStatus =
    direction === 'outbound' && (order.status === 'SHIPPED_OUT' || order.status === 'AT_VENDOR') ? { status: 'DRAFT' as const }
    : direction === 'inbound' && order.status === 'RETURNED' ? { status: 'AT_VENDOR' as const }
    : {}

  await prisma.repairOrder.update({
    where: { id: params.id },
    data: direction === 'outbound'
      ? { outboundCarrier: null, outboundTracking: null, outboundShipmentId: null, ...revertStatus }
      : { inboundCarrier: null, inboundTracking: null, inboundShipmentId: null, ...revertStatus },
  })

  return NextResponse.json({ ok: true, voided: active.length, carrierVoided: !carrierError, carrierError })
}
