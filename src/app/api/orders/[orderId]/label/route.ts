/**
 * GET /api/orders/[orderId]/label
 * Returns the saved shipping label for an order (for reprinting).
 * If labelData is missing but a ShipStation V2 label ID exists, auto-refetches from ShipStation.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const label = await prisma.orderLabel.findUnique({ where: { orderId: params.orderId } })
  if (!label) return NextResponse.json({ error: 'No label found for this order' }, { status: 404 })

  let { labelData } = label

  // Auto-refetch from ShipStation if label data is missing but we have a V2 label ID
  if (!labelData && label.ssShipmentId?.startsWith('se-')) {
    try {
      const account = await prisma.shipStationAccount.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
      })
      if (account) {
        const v2Key = account.v2ApiKeyEnc ? decrypt(account.v2ApiKeyEnc) : null
        const client = new ShipStationClient(decrypt(account.apiKeyEnc), account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '', v2Key)
        labelData = await client.getLabelV2(label.ssShipmentId)

        // Persist for future requests
        await prisma.orderLabel.update({
          where: { id: label.id },
          data: { labelData },
        })
        console.log('[label] Re-fetched label PDF from ShipStation for order %s (label %s)', params.orderId, label.ssShipmentId)
      }
    } catch (err) {
      console.error('[label] Failed to re-fetch label from ShipStation:', err)
    }
  }

  // Log a "shipping label printed" event to the transaction/audit history so we can
  // trace exactly when (and by whom) an order's label was printed when investigating
  // shipping discrepancies. Best-effort — a logging failure must never block the print.
  try {
    const ord = await prisma.order.findUnique({ where: { id: params.orderId }, select: { amazonOrderId: true, orderSource: true } })
    await prisma.auditEvent.create({
      data: {
        entityType: 'orderLabel',
        entityId: params.orderId,
        action: 'label_printed',
        actorId: user.dbId ?? null,
        actorLabel: user.email ?? 'unknown',
        after: {
          orderType: 'marketplace',
          orderSource: ord?.orderSource ?? null,
          orderNumber: ord?.amazonOrderId ?? null,
          trackingNumber: label.trackingNumber ?? null,
          carrier: label.carrier ?? null,
          serviceCode: label.serviceCode ?? null,
          labelFormat: label.labelFormat ?? null,
        },
      },
    })
  } catch (e) {
    console.error('[label] Failed to log label-print audit event:', e)
  }

  return NextResponse.json({
    trackingNumber: label.trackingNumber,
    labelData,
    labelFormat:    label.labelFormat,
    carrier:        label.carrier,
    serviceCode:    label.serviceCode,
    shipmentCost:   label.shipmentCost,
    isTest:         label.isTest,
    createdAt:      label.createdAt,
  })
}
