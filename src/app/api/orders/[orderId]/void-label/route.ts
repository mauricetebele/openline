/**
 * POST /api/orders/[orderId]/void-label
 * Voids the ShipStation-purchased label for an order in AWAITING_VERIFICATION.
 * If ssShipmentId is not stored, looks it up by tracking number first.
 * On success, deletes the OrderLabel and moves the order back to PROCESSING.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { ShipStationClient } from '@/lib/shipstation/client'
import { decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await prisma.order.findUnique({
      where:   { id: params.orderId },
      include: { label: true },
    })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.workflowStatus !== 'AWAITING_VERIFICATION') {
      return NextResponse.json(
        { error: 'Only orders in Awaiting Verification can have their label voided' },
        { status: 409 },
      )
    }
    if (!order.label) {
      return NextResponse.json({ error: 'No label found for this order' }, { status: 404 })
    }

    // Load ShipStation account
    const ssAccount = await prisma.shipStationAccount.findFirst({
      where:   { isActive: true },
      orderBy: { createdAt: 'asc' },
      select:  { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
    })
    if (!ssAccount) {
      return NextResponse.json({ error: 'No active ShipStation account found' }, { status: 400 })
    }

    const v2ApiKey = ssAccount.v2ApiKeyEnc ? decrypt(ssAccount.v2ApiKeyEnc) : null
    const client = new ShipStationClient(
      decrypt(ssAccount.apiKeyEnc),
      ssAccount.apiSecretEnc ? decrypt(ssAccount.apiSecretEnc) : '',
      v2ApiKey,
    )

    // Resolve shipmentId — use stored value or look up by tracking number
    let shipmentId = order.label.ssShipmentId
    if (!shipmentId) {
      const shipment = await client.findShipmentByTracking(order.label.trackingNumber)
      if (!shipment) {
        return NextResponse.json(
          { error: `Could not find a ShipStation shipment for tracking number ${order.label.trackingNumber}` },
          { status: 404 },
        )
      }
      shipmentId = shipment.shipmentId
      // Persist so future voids are instant
      await prisma.orderLabel.update({
        where: { orderId: params.orderId },
        data:  { ssShipmentId: shipmentId },
      })
    }

    // Request void from ShipStation
    const result = await client.voidLabel(shipmentId)
    if (!result.approved) {
      return NextResponse.json(
        { error: `ShipStation declined the void request: ${result.message}` },
        { status: 422 },
      )
    }

    // Delete the label and move order back to PROCESSING
    await prisma.$transaction([
      prisma.orderLabel.delete({ where: { orderId: params.orderId } }),
      prisma.order.update({
        where: { id: params.orderId },
        data:  { workflowStatus: 'PROCESSING' },
      }),
    ])

    return NextResponse.json({ success: true, message: result.message })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/orders/[orderId]/void-label]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
