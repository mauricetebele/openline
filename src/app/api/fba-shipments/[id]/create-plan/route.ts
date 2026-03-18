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

    // Extract packing group ID from packing option
    // Amazon may return packingGroups as array of objects OR array of strings
    let packingGroupId: string | null = null
    const pg = firstOption.packingGroups
    if (Array.isArray(pg) && pg.length > 0) {
      packingGroupId = typeof pg[0] === 'string' ? pg[0] : pg[0]?.packingGroupId ?? null
    }
    // Also check packingGroupIds (alternative field name)
    if (!packingGroupId && Array.isArray(firstOption.packingGroupIds) && firstOption.packingGroupIds.length > 0) {
      packingGroupId = firstOption.packingGroupIds[0]
    }

    // Fallback: list packing groups separately
    if (!packingGroupId) {
      try {
        const groups = await listPackingGroups(shipment.accountId, planResp.inboundPlanId)
        packingGroupId = groups[0]?.packingGroupId ?? (typeof groups[0] === 'string' ? groups[0] : null)
      } catch (pgErr) {
        console.warn('[create-plan] listPackingGroups failed:', pgErr)
      }
    }

    // Fallback: re-list packing options after confirmation
    if (!packingGroupId) {
      const refreshedOptions = await listPackingOptions(shipment.accountId, planResp.inboundPlanId)
      console.log('[create-plan] Refreshed packing options:', JSON.stringify(refreshedOptions))
      for (const opt of refreshedOptions) {
        const rpg = opt.packingGroups ?? opt.packingGroupIds
        if (Array.isArray(rpg) && rpg.length > 0) {
          packingGroupId = typeof rpg[0] === 'string' ? rpg[0] : rpg[0]?.packingGroupId ?? null
          if (packingGroupId) break
        }
      }
    }

    if (!packingGroupId) {
      console.error('[create-plan] No packing group found. Raw first option:', JSON.stringify(firstOption))
      console.error('[create-plan] All keys on first option:', Object.keys(firstOption))
    }

    // Update shipment — save plan even if packingGroupId is null so we don't lose the inbound plan
    await prisma.fbaShipment.update({
      where: { id: params.id },
      data: {
        status: 'PLAN_CREATED',
        inboundPlanId: planResp.inboundPlanId,
        packingOptionId: firstOption.packingOptionId,
        packingGroupId,
        lastError: packingGroupId ? null : 'Packing group not resolved — check logs',
        lastErrorAt: packingGroupId ? null : new Date(),
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
