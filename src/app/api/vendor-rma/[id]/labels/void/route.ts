/**
 * POST /api/vendor-rma/[id]/labels/void  — void a purchased label set
 * Body: { labelSetId: string, force?: boolean }
 *
 * Voids the whole shipment (all pieces) with the carrier, then marks the pieces
 * voided. `force: true` marks them voided even if the carrier void fails (e.g.
 * already voided), so stale sets can be cleared.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { voidReturnLabel } from '@/lib/ups-tracking'
import { loadFedExCredentials, cancelShipment } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { labelSetId, force } = (await req.json()) as { labelSetId?: string; force?: boolean }
  if (!labelSetId) return NextResponse.json({ error: 'labelSetId is required' }, { status: 400 })

  const labels = await prisma.vendorReturnLabel.findMany({
    where: { vendorRmaId: params.id, labelSetId },
  })
  if (labels.length === 0) return NextResponse.json({ error: 'Label set not found' }, { status: 404 })
  if (labels.every(l => l.voided)) return NextResponse.json({ ok: true, alreadyVoided: true })

  const head = labels[0]
  let carrierError: string | null = null
  try {
    if (head.carrier === 'ups') {
      const shipmentId = head.shipmentId ?? head.trackingNumber
      await voidReturnLabel(shipmentId, head.upsCredentialId ?? undefined)
    } else if (head.carrier === 'fedex') {
      const creds = await loadFedExCredentials()
      if (!creds) throw new Error('FedEx is not configured')
      await cancelShipment(creds, head.shipmentId ?? head.trackingNumber)
    }
  } catch (e) {
    carrierError = e instanceof Error ? e.message : 'Carrier void failed'
  }

  if (carrierError && !force) {
    return NextResponse.json({ error: `Carrier void failed: ${carrierError}` }, { status: 502 })
  }

  await prisma.vendorReturnLabel.updateMany({
    where: { vendorRmaId: params.id, labelSetId },
    data: { voided: true, voidedAt: new Date() },
  })

  return NextResponse.json({ ok: true, carrierVoided: !carrierError, carrierError })
}
