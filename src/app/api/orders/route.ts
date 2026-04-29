/**
 * GET    /api/orders?accountId=&tab=pending|unshipped|shipped&page=&pageSize=&search=
 * DELETE /api/orders — delete all orders (admin only, for testing)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

type WorkflowStatus = 'PENDING' | 'PROCESSING' | 'AWAITING_VERIFICATION' | 'SHIPPED' | 'CANCELLED'

const TAB_WORKFLOW: Record<string, WorkflowStatus> = {
  pending:   'PENDING',
  unshipped: 'PROCESSING',
  awaiting:  'AWAITING_VERIFICATION',
  shipped:   'SHIPPED',
  cancelled: 'CANCELLED',
}

type SortDir = 'asc' | 'desc'
const SORT_FIELDS: Record<string, keyof Prisma.OrderOrderByWithRelationInput> = {
  olmNumber:            'olmNumber',
  purchaseDate:         'purchaseDate',
  latestShipDate:       'latestShipDate',
  orderTotal:           'orderTotal',
  shipToName:           'shipToName',
  shipToState:          'shipToState',
  workflowStatus:       'workflowStatus',
  shipmentServiceLevel: 'shipmentServiceLevel',
  presetRateAmount:     'presetRateAmount',
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = req.nextUrl
    const accountId = searchParams.get('accountId')?.trim()
    if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

    const tabParam = searchParams.get('tab')?.toLowerCase() ?? 'pending'
    const workflowStatus: WorkflowStatus = TAB_WORKFLOW[tabParam] ?? 'PENDING'

    const page     = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? '50')))
    const skip     = (page - 1) * pageSize
    const search   = searchParams.get('search')?.trim()

    const sortByParam = searchParams.get('sortBy') ?? 'purchaseDate'
    const sortDirParam = (searchParams.get('sortDir') ?? 'desc') as SortDir
    const sortField = SORT_FIELDS[sortByParam] ?? 'purchaseDate'
    const orderBy: Prisma.OrderOrderByWithRelationInput = { [sortField]: sortDirParam }

    const orderSource = searchParams.get('orderSource')?.toLowerCase()

    const where: Prisma.OrderWhereInput = {
      accountId,
      workflowStatus,
      // Exclude Amazon Pending-payment orders from the grid — they exist only
      // for background available-qty calculation, not for fulfillment.
      orderStatus: { not: 'Pending' },
      // Exclude FBA orders — Amazon fulfills these, not us
      fulfillmentChannel: { not: 'AFN' },
      // Channel filter: narrow to a single order source when requested
      ...(orderSource === 'amazon' || orderSource === 'backmarket'
        ? { orderSource }
        : {}),
    }

    if (search) {
      const olmNum = search.toUpperCase().startsWith('OLM-') ? parseInt(search.slice(4), 10) : parseInt(search, 10)
      where.OR = [
        { amazonOrderId: { contains: search, mode: 'insensitive' } },
        { items: { some: { sellerSku: { contains: search, mode: 'insensitive' } } } },
        { items: { some: { title: { contains: search, mode: 'insensitive' } } } },
        { shipTracking: { contains: search, mode: 'insensitive' } },
        { label: { trackingNumber: { contains: search, mode: 'insensitive' } } },
        ...(Number.isFinite(olmNum) ? [{ olmNumber: olmNum }] : []),
      ]
    }

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          items: {
            orderBy: { sellerSku: 'asc' },
            include: { grade: { select: { grade: true } } },
          },
          label: {
            select: {
              trackingNumber: true,
              labelFormat:    true,
              carrier:        true,
              serviceCode:    true,
              shipmentCost:   true,
              createdAt:      true,
              isTest:         true,
              ssShipmentId:   true,
            },
          },
          serialAssignments: {
            select: {
              id:          true,
              orderItemId: true,
              inventorySerial: { select: { serialNumber: true } },
            },
          },
          appliedPackagePreset: {
            select: { id: true, name: true },
          },
        },
      }),
    ])

    // Batch-lookup isSerializable for all SKUs across all orders
    const allSkus = Array.from(new Set(
      orders.flatMap(o => o.items.map(i => i.sellerSku).filter((s): s is string => s != null))
    ))
    const serializableProducts = allSkus.length > 0
      ? await prisma.product.findMany({
          where: { sku: { in: allSkus }, isSerializable: true },
          select: { sku: true },
        })
      : []
    const serializableSkus = new Set(serializableProducts.map(p => p.sku))

    // Batch-lookup marketplace SKU → internal SKU + grade mappings
    const mskuMappings = allSkus.length > 0
      ? await prisma.productGradeMarketplaceSku.findMany({
          where: { sellerSku: { in: allSkus } },
          include: { product: { select: { sku: true, isSerializable: true } }, grade: { select: { grade: true } } },
        })
      : []
    const mskuMap = new Map(mskuMappings.map(m => [m.sellerSku, m]))

    // Compute requiresTransparency + isSerializable + internalSku/gradeName per order item
    const data = orders.map(order => ({
      ...order,
      requiresTransparency: order.items.some(item => item.isTransparency),
      items: order.items.map(item => {
        const mapping = item.sellerSku ? mskuMap.get(item.sellerSku) : undefined
        const directMatch = item.sellerSku ? serializableSkus.has(item.sellerSku) : false
        const mappedMatch = mapping?.product.isSerializable ?? false
        return {
          ...item,
          isSerializable: directMatch || mappedMatch,
          internalSku:    mapping?.product.sku ?? null,
          mappedGradeName: mapping?.grade?.grade ?? item.grade?.grade ?? null,
        }
      }),
    }))

    return NextResponse.json({
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[GET /api/orders]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Delete in dependency order — children with Restrict FK first
  const rmaSerials = await prisma.marketplaceRMASerial.deleteMany({})
  const rmaItems = await prisma.marketplaceRMAItem.deleteMany({})
  const rmas = await prisma.marketplaceRMA.deleteMany({})
  const serialAssignments = await prisma.orderSerialAssignment.deleteMany({})
  const reservations = await prisma.orderInventoryReservation.deleteMany({})
  const labels = await prisma.orderLabel.deleteMany({})
  const batchItems = await prisma.labelBatchItem.deleteMany({})
  const items = await prisma.orderItem.deleteMany({})
  const orders = await prisma.order.deleteMany({})
  const jobs = await prisma.orderSyncJob.deleteMany({})

  return NextResponse.json({
    deleted: {
      orders: orders.count,
      items: items.count,
      labels: labels.count,
      serialAssignments: serialAssignments.count,
      reservations: reservations.count,
      rmas: rmas.count,
      rmaItems: rmaItems.count,
      rmaSerials: rmaSerials.count,
      batchItems: batchItems.count,
      syncJobs: jobs.count,
    },
  })
}
