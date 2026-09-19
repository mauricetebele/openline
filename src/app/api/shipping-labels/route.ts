/**
 * POST /api/shipping-labels  — create a manual multi-piece shipping label
 * GET  /api/shipping-labels  — history of labels created with this tool
 *
 * Labels are stored in ReturnLabel with labelType MANUAL_UPS | MANUAL_FEDEX |
 * MANUAL_SS (one row per piece). Their tracking numbers feed orphan
 * reconciliation, so they are never flagged as orphaned ShipStation labels.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { parseManualLabelInput, createManualShipment, type ManualLabelInput, type CreatedShipment } from '@/lib/shipping-labels'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MANUAL_TYPES = ['MANUAL_UPS', 'MANUAL_FEDEX', 'MANUAL_SS']

/**
 * Create a synthetic "accessorial" order tied to a just-created label. It lands in
 * Awaiting Verification on the fulfillment grid with a serial-less line item, so
 * the warehouse can verify + ship it against the label — with NO inventory impact.
 */
async function createAccessorialOrder(input: ManualLabelInput, result: CreatedShipment, accessoryName: string) {
  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true }, select: { id: true } })
  if (!account) throw new Error('No active Amazon account to attach the accessorial order to')
  const piece = result.pieces[0]

  // olmNumber is assigned as max+1 (not atomic) — retry on unique conflicts.
  for (let attempt = 0; attempt < 4; attempt++) {
    const agg = await prisma.order.aggregate({ _max: { olmNumber: true } })
    const olmNumber = (agg._max.olmNumber ?? 999) + 1
    try {
      const order = await prisma.order.create({
        data: {
          accountId: account.id,
          amazonOrderId: `ACC-${olmNumber}`,
          olmNumber,
          orderSource: 'amazon',
          orderStatus: 'Accepted',            // must not be 'Pending'
          workflowStatus: 'AWAITING_VERIFICATION',
          purchaseDate: new Date(),
          lastUpdateDate: new Date(),
          lastSyncedAt: new Date(),
          orderTotal: new Prisma.Decimal(0),
          numberOfItemsUnshipped: 1,
          shipToName: input.shipTo.name,
          shipToAddress1: input.shipTo.address1,
          shipToAddress2: input.shipTo.address2 ?? null,
          shipToCity: input.shipTo.city,
          shipToState: input.shipTo.state,
          shipToPostal: input.shipTo.postal,
          shipToCountry: input.shipTo.country ?? 'US',
          shipToPhone: input.shipTo.phone ?? null,
          items: { create: [{ orderItemId: 'acc-1', title: accessoryName, quantityOrdered: 1, itemPrice: new Prisma.Decimal(0) }] },
          label: {
            create: {
              trackingNumber: piece.trackingNumber,
              labelData: piece.labelBase64,
              labelFormat: piece.labelFormat,
              carrier: result.carrier,
              serviceCode: input.serviceCode,
              ...(result.shipmentCost != null ? { shipmentCost: new Prisma.Decimal(result.shipmentCost.toFixed(2)) } : {}),
            },
          },
        },
        select: { id: true, olmNumber: true },
      })
      return order
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 3) continue
      throw e
    }
  }
  throw new Error('Could not assign an OLM number for the accessorial order')
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  try {
    const input = parseManualLabelInput(body)
    const b = body as { accessorial?: boolean; accessoryName?: string }
    const accessoryName = b.accessorial ? (typeof b.accessoryName === 'string' ? b.accessoryName.trim() : '') : ''
    if (b.accessorial && !accessoryName) return NextResponse.json({ error: 'Enter which accessory is being shipped' }, { status: 400 })

    const result = await createManualShipment(input)

    let accessorialOrder: { id: string; olmNumber: number | null } | null = null
    if (b.accessorial && accessoryName) {
      try { accessorialOrder = await createAccessorialOrder(input, result, accessoryName) }
      catch (e) { return NextResponse.json({ ...result, accessorialError: e instanceof Error ? e.message : 'Accessorial order failed' }) }
    }

    return NextResponse.json({ ...result, accessorialOrder })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Label creation failed' }, { status: 400 })
  }
}

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const labels = await prisma.returnLabel.findMany({
    where: { labelType: { in: MANUAL_TYPES } },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true, labelType: true, shipFromName: true, shipFromAddress1: true, shipFromCity: true,
      shipFromState: true, shipFromPostal: true, serviceCode: true, serviceLabel: true,
      weightValue: true, weightUnit: true, trackingNumber: true, shipmentId: true,
      shipmentCost: true, currency: true, voided: true, voidedAt: true, createdAt: true,
      upsCredential: { select: { nickname: true } },
    },
  })

  return NextResponse.json(labels)
}
