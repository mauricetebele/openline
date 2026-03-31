/**
 * POST /api/fba-shipments/[id]/set-boxes
 *
 * Validates box contents match shipment items, sets packing info at Amazon,
 * generates placement options, returns them to the UI.
 *
 * Status: PLAN_CREATED → PACKING_SET
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import {
  setPackingInformation,
  pollOperationStatus,
  generatePlacementOptions,
  listPlacementOptions,
  listShipments,
  getShipment,
  type BoxInput,
} from '@/lib/amazon/fba-inbound'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface BoxPayload {
  weightLb: number
  lengthIn: number
  widthIn: number
  heightIn: number
  items: Array<{ shipmentItemId: string; quantity: number }>
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: { items: true },
  })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (shipment.status !== 'PLAN_CREATED') {
    return NextResponse.json({ error: 'Shipment must be in PLAN_CREATED status' }, { status: 409 })
  }
  if (!shipment.inboundPlanId || !shipment.packingGroupId) {
    return NextResponse.json({ error: 'Missing inbound plan or packing group' }, { status: 400 })
  }

  let body: { boxes: BoxPayload[] }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.boxes?.length) {
    return NextResponse.json({ error: 'At least one box is required' }, { status: 400 })
  }

  // Validate box item totals match shipment items
  const itemTotals = new Map<string, number>()
  for (const box of body.boxes) {
    for (const bi of box.items) {
      itemTotals.set(bi.shipmentItemId, (itemTotals.get(bi.shipmentItemId) ?? 0) + bi.quantity)
    }
  }
  for (const item of shipment.items) {
    const boxedQty = itemTotals.get(item.id) ?? 0
    if (boxedQty !== item.quantity) {
      return NextResponse.json(
        { error: `Box quantity mismatch for item ${item.sellerSku}: boxed ${boxedQty}, expected ${item.quantity}` },
        { status: 400 },
      )
    }
  }

  try {
    // Build item lookup for Amazon API
    const itemById = new Map(shipment.items.map(i => [i.id, i]))

    // Track per-item prepOwner; start with NONE, auto-correct on error
    const prepOwners = new Map<string, 'NONE' | 'SELLER' | 'AMAZON'>(
      shipment.items.map(i => [i.sellerSku, 'NONE']),
    )

    const buildBoxes = (): BoxInput[] => body.boxes.map(box => ({
      weight: { unit: 'LB', value: box.weightLb },
      dimensions: {
        unitOfMeasurement: 'IN',
        length: box.lengthIn,
        width: box.widthIn,
        height: box.heightIn,
      },
      items: box.items.map(bi => {
        const item = itemById.get(bi.shipmentItemId)!
        return {
          msku: item.sellerSku,
          fnSku: item.fnsku,
          quantity: bi.quantity,
          prepOwner: prepOwners.get(item.sellerSku) ?? 'NONE' as const,
          labelOwner: 'SELLER' as const,
        }
      }),
      contentInformationSource: 'BOX_CONTENT_PROVIDED' as const,
      quantity: 1 as const,
    }))

    // 1. Set packing information (with prepOwner auto-retry)
    let packResp
    try {
      packResp = await setPackingInformation(
        shipment.accountId, shipment.inboundPlanId, shipment.packingGroupId, buildBoxes(),
      )
    } catch (firstErr) {
      const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr)
      const requiresPrep = /(\S+),\s*expected:.*?prepOwner=SELLER.*?provided:.*?prepOwner=NONE/g
      const noPrep = /(\S+),\s*expected:.*?prepOwner=NONE.*?provided:.*?prepOwner=SELLER/g
      // Also match the simpler format
      const requiresPrep2 = /(\S+)\s+requires prepOwner but NONE/g
      const noPrep2 = /(\S+)\s+does not require prepOwner but (?:SELLER|AMAZON)/g
      let matched = false
      let m
      while ((m = requiresPrep.exec(errMsg)) !== null) { prepOwners.set(m[1], 'SELLER'); matched = true }
      while ((m = noPrep.exec(errMsg)) !== null) { prepOwners.set(m[1], 'NONE'); matched = true }
      while ((m = requiresPrep2.exec(errMsg)) !== null) { prepOwners.set(m[1], 'SELLER'); matched = true }
      while ((m = noPrep2.exec(errMsg)) !== null) { prepOwners.set(m[1], 'NONE'); matched = true }

      // Also parse "expected: Item(...prepOwner=SELLER...)" pattern from the error details
      const expectedPattern = /for (\S+), expected:.*?prepOwner=(\w+)/g
      while ((m = expectedPattern.exec(errMsg)) !== null) {
        prepOwners.set(m[1], m[2] as 'SELLER' | 'AMAZON' | 'NONE')
        matched = true
      }

      if (!matched) throw firstErr
      packResp = await setPackingInformation(
        shipment.accountId, shipment.inboundPlanId, shipment.packingGroupId, buildBoxes(),
      )
    }
    await pollOperationStatus(shipment.accountId, packResp.operationId)

    // 2. Generate placement options
    const placementResp = await generatePlacementOptions(shipment.accountId, shipment.inboundPlanId)
    await pollOperationStatus(shipment.accountId, placementResp.operationId)

    // 3. List placement options
    const placementOptions = await listPlacementOptions(shipment.accountId, shipment.inboundPlanId)

    // 4. Fetch shipment details (destination FCs) for enrichment
    const allShipmentIds = Array.from(new Set(placementOptions.flatMap(o => o.shipmentIds ?? [])))
    let shipments = await listShipments(shipment.accountId, shipment.inboundPlanId).catch(() => [])
    if (shipments.length === 0 && allShipmentIds.length > 0) {
      const results = await Promise.allSettled(
        allShipmentIds.map(sid => getShipment(shipment.accountId, shipment.inboundPlanId!, sid))
      )
      shipments = results
        .filter((r): r is PromiseFulfilledResult<Record<string, unknown>> => r.status === 'fulfilled')
        .map(r => r.value)
    }

    // Save boxes to DB
    await prisma.$transaction(async tx => {
      // Delete old boxes if retrying
      await tx.fbaShipmentBox.deleteMany({ where: { shipmentId: params.id } })

      for (let i = 0; i < body.boxes.length; i++) {
        const box = body.boxes[i]
        await tx.fbaShipmentBox.create({
          data: {
            shipmentId: params.id,
            boxNumber: i + 1,
            weightLb: box.weightLb,
            lengthIn: box.lengthIn,
            widthIn: box.widthIn,
            heightIn: box.heightIn,
            items: {
              create: box.items.map(bi => ({
                shipmentItemId: bi.shipmentItemId,
                quantity: bi.quantity,
              })),
            },
          },
        })
      }

      await tx.fbaShipment.update({
        where: { id: params.id },
        data: { status: 'PACKING_SET', lastError: null, lastErrorAt: null },
      })
    })

    return NextResponse.json({ success: true, placementOptions, shipments })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: { lastError: message, lastErrorAt: new Date() },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
