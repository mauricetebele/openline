/**
 * GET  /api/shipping-labels/[id]  — retrieve a label image (base64) for reprint
 * POST /api/shipping-labels/[id]  — void the label at the carrier (UPS/FedEx/ShipStation)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { voidReturnLabel } from '@/lib/ups-tracking'
import { loadFedExCredentials, cancelShipment } from '@/lib/fedex/client'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const label = await prisma.returnLabel.findUnique({
    where: { id: params.id },
    select: { labelData: true, trackingNumber: true, voided: true },
  })
  if (!label) return NextResponse.json({ error: 'Label not found' }, { status: 404 })

  return NextResponse.json({ labelData: label.labelData, labelFormat: 'pdf', trackingNumber: label.trackingNumber, voided: label.voided })
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const label = await prisma.returnLabel.findUnique({
    where: { id: params.id },
    select: { shipmentId: true, trackingNumber: true, voided: true, labelType: true, upsCredentialId: true },
  })
  if (!label) return NextResponse.json({ error: 'Label not found' }, { status: 404 })
  if (label.voided) return NextResponse.json({ error: 'Label already voided' }, { status: 400 })

  try {
    if (label.labelType === 'MANUAL_FEDEX') {
      const creds = await loadFedExCredentials()
      if (!creds) throw new Error('FedEx credentials not configured')
      await cancelShipment(creds, label.trackingNumber)
    } else if (label.labelType === 'MANUAL_SS') {
      const account = await prisma.shipStationAccount.findFirst({
        where: { isActive: true }, orderBy: { createdAt: 'asc' },
        select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
      })
      if (!account) throw new Error('No active ShipStation account connected')
      const client = new ShipStationClient(
        decrypt(account.apiKeyEnc),
        account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '',
        account.v2ApiKeyEnc ? decrypt(account.v2ApiKeyEnc) : null,
      )
      const res = await client.voidLabel(label.shipmentId)
      if (!res.approved) throw new Error(res.message || 'ShipStation declined the void')
    } else {
      // MANUAL_UPS (default)
      await voidReturnLabel(label.shipmentId, label.upsCredentialId ?? undefined)
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Void failed' }, { status: 500 })
  }

  // UPS/FedEx void the whole shipment — mark every piece sharing the shipmentId.
  await prisma.returnLabel.updateMany({
    where: { shipmentId: label.shipmentId, labelType: label.labelType, voided: false },
    data: { voided: true, voidedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
