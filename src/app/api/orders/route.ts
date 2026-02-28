/**
 * GET /api/orders?accountId=&tab=pending|unshipped|shipped&page=&pageSize=&search=
 * Returns orders filtered by workflow status tab.
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

    const where: Prisma.OrderWhereInput = {
      accountId,
      workflowStatus,
    }

    if (search) {
      where.OR = [
        { amazonOrderId: { contains: search, mode: 'insensitive' } },
        { items: { some: { sellerSku: { contains: search, mode: 'insensitive' } } } },
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
          items: { orderBy: { sellerSku: 'asc' } },
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
        },
      }),
    ])

    return NextResponse.json({
      data: orders,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[GET /api/orders]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
