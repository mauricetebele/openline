/**
 * POST /api/fba-shipments/[id]/create-plan
 *
 * Creates inbound plan at Amazon → polls → generates packing options →
 * polls → auto-confirms first packing option → polls.
 *
 * Status: DRAFT → PLAN_CREATED
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import {
  createInboundPlan,
  pollOperationStatus,
  generatePackingOptions,
  listPackingOptions,
  confirmPackingOption,
  listPackingGroups,
} from '@/lib/amazon/fba-inbound'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: {
      account: true,
      warehouse: true,
      items: true,
    },
  })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (shipment.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Shipment must be in DRAFT status' }, { status: 409 })
  }
  if (!shipment.warehouseId || !shipment.warehouse) {
    return NextResponse.json({ error: 'Warehouse must be assigned before creating a plan. Complete Step 2 first.' }, { status: 400 })
  }

  const wh = shipment.warehouse
  if (!wh.addressLine1 || !wh.city || !wh.state || !wh.postalCode) {
    return NextResponse.json({ error: 'Warehouse address is incomplete' }, { status: 400 })
  }

  try {
    // 1. Create inbound plan
    const planResp = await createInboundPlan(shipment.accountId, {
      sourceAddress: {
        name: wh.name,
        addressLine1: wh.addressLine1,
        addressLine2: wh.addressLine2 ?? undefined,
        city: wh.city,
        stateOrProvinceCode: wh.state,
        postalCode: wh.postalCode,
        countryCode: wh.countryCode,
        phoneNumber: wh.phone ?? undefined,
      },
      items: shipment.items.map(item => ({
        msku: item.sellerSku,
        fnsku: item.fnsku,
        asin: item.asin ?? '',
        labelOwner: 'SELLER' as const,
        quantity: item.quantity,
        prepOwner: 'SELLER' as const,
      })),
      marketplaceIds: [shipment.account.marketplaceId],
    })

    await pollOperationStatus(shipment.accountId, planResp.operationId)

    // 2. Generate packing options
    const genPackResp = await generatePackingOptions(shipment.accountId, planResp.inboundPlanId)
    await pollOperationStatus(shipment.accountId, genPackResp.operationId)

    // 3. List and auto-confirm first packing option
    const packingOptions = await listPackingOptions(shipment.accountId, planResp.inboundPlanId)
    if (packingOptions.length === 0) {
      throw new Error('No packing options available from Amazon')
    }

    const firstOption = packingOptions[0]
    const confirmResp = await confirmPackingOption(
      shipment.accountId,
      planResp.inboundPlanId,
      firstOption.packingOptionId,
    )
    await pollOperationStatus(shipment.accountId, confirmResp.operationId)

    // Fetch packing groups after confirming packing option
    const packingGroups = await listPackingGroups(shipment.accountId, planResp.inboundPlanId)
    const packingGroupId = packingGroups[0]?.packingGroupId ?? firstOption.packingGroups?.[0]?.packingGroupId ?? null
    if (!packingGroupId) {
      throw new Error('No packing group returned by Amazon after confirming packing option')
    }

    // Update shipment
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: {
        status: 'PLAN_CREATED',
        inboundPlanId: planResp.inboundPlanId,
        packingOptionId: firstOption.packingOptionId,
        packingGroupId,
        lastError: null,
        lastErrorAt: null,
      },
    })

    return NextResponse.json({ success: true, inboundPlanId: planResp.inboundPlanId, packingGroupId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: { lastError: message, lastErrorAt: new Date() },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
