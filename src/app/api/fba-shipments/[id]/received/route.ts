/**
 * GET /api/fba-shipments/[id]/received
 *
 * Returns received vs shipped counts per Amazon sub-shipment.
 * Calls the v0 SP-API to get QuantityReceived for each confirmationId.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { getShipmentItemsV0 } from '@/lib/amazon/fba-inbound'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id },
    select: { accountId: true, labelData: true, shipmentConfirmationId: true },
  })
  if (!shipment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Extract confirmationIds from labelData
  const confirmationIds: string[] = []
  try {
    const parsed = JSON.parse(shipment.labelData ?? '[]')
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (entry?.confirmationId) confirmationIds.push(entry.confirmationId)
      }
    }
  } catch { /* ignore */ }

  // Fallback to top-level field
  if (confirmationIds.length === 0 && shipment.shipmentConfirmationId) {
    confirmationIds.push(shipment.shipmentConfirmationId)
  }

  if (confirmationIds.length === 0) {
    return NextResponse.json({ byShipment: {}, totalReceived: 0, totalShipped: 0 })
  }

  const byShipment: Record<string, { received: number; shipped: number }> = {}
  let totalReceived = 0
  let totalShipped = 0

  for (const cid of confirmationIds) {
    try {
      const items = await getShipmentItemsV0(shipment.accountId, cid)
      let received = 0
      let shipped = 0
      for (const item of items) {
        received += item.QuantityReceived ?? 0
        shipped += item.QuantityShipped ?? 0
      }
      byShipment[cid] = { received, shipped }
      totalReceived += received
      totalShipped += shipped
    } catch {
      byShipment[cid] = { received: 0, shipped: 0 }
    }
  }

  return NextResponse.json({ byShipment, totalReceived, totalShipped })
}
