/**
 * Incoming Amazon (MFN) returns that have a return mailing label tracking
 * number, classified against the processing-SLA threat model.
 *
 * Goal: process every return that lands here within 4 calendar days of delivery.
 *
 * Threat model (per ops):
 *   - not tendered to UPS (label made, no movement) ............ NOT a threat
 *   - has movement but not delivered within 7 days of shipping . lost in transit  → THREAT
 *   - delivered but not processed in Process Returns within 4
 *     calendar days of delivery ............................... auto-refund risk → THREAT
 *
 * "Processed" is matched by tracking number against the process_returns table
 * (a ProcessReturn row carries the package's trackingNumber, not an order id).
 *
 * GET  — paginated, filterable grid data + whole-dataset summary counts.
 * POST — refresh the live carrier status for one return by id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { getCarrierStatus } from '@/lib/ups-tracking'

const DELIVERY_SLA_DAYS = 4 // process within N calendar days of delivery
const TRANSIT_SLA_DAYS = 7 // delivered within N days of shipping, else "lost"

/**
 * Classification CTE shared by the data and summary queries. Produces, per
 * incoming return that has a tracking number:
 *   statusGroup: delivered | in_transit | not_tendered | needs_status | unknown
 *   processed:   whether a process_returns row exists for this tracking number
 *   threat:      'unprocessed_delivered' | 'lost_in_transit' | null
 */
const classifiedCte = Prisma.sql`
  WITH classified AS (
    SELECT
      m.id,
      m."orderId",
      m."trackingNumber",
      m."returnCarrier",
      m."carrierStatus",
      m."trackingUpdatedAt",
      m."returnDate",
      m."deliveredAt",
      p."processedAt"      AS "processedAt",
      p."processedOutcome" AS "processedOutcome",
      (p.id IS NOT NULL)   AS processed,
      CASE
        WHEN m."carrierStatus" ILIKE '%delivered%' THEN 'delivered'
        WHEN m."carrierStatus" ILIKE '%transit%'
          OR m."carrierStatus" ILIKE '%on the way%'
          OR m."carrierStatus" ILIKE '%we have your package%'
          OR m."carrierStatus" ILIKE '%dropped off%'
          OR m."carrierStatus" ILIKE '%out for delivery%'
          OR m."carrierStatus" ILIKE '%exception%'
          OR m."carrierStatus" ILIKE '%delay%' THEN 'in_transit'
        WHEN m."carrierStatus" ILIKE '%ready for ups%'
          OR m."carrierStatus" ILIKE '%label created%'
          OR m."carrierStatus" ILIKE '%order processed%'
          OR m."carrierStatus" ILIKE '%shipment ready%'
          OR m."carrierStatus" ILIKE '%billing information received%' THEN 'not_tendered'
        WHEN m."carrierStatus" IS NULL THEN 'needs_status'
        ELSE 'unknown'
      END AS "statusGroup",
      CASE
        WHEN m."carrierStatus" ILIKE '%delivered%'
          AND p.id IS NULL
          AND m."deliveredAt" IS NOT NULL
          AND m."deliveredAt" < now() - (${DELIVERY_SLA_DAYS} || ' days')::interval
          THEN 'unprocessed_delivered'
        WHEN (
            m."carrierStatus" ILIKE '%transit%'
            OR m."carrierStatus" ILIKE '%on the way%'
            OR m."carrierStatus" ILIKE '%we have your package%'
            OR m."carrierStatus" ILIKE '%dropped off%'
            OR m."carrierStatus" ILIKE '%out for delivery%'
            OR m."carrierStatus" ILIKE '%exception%'
            OR m."carrierStatus" ILIKE '%delay%'
          )
          AND m."returnDate" IS NOT NULL
          AND m."returnDate" < now() - (${TRANSIT_SLA_DAYS} || ' days')::interval
          THEN 'lost_in_transit'
        ELSE NULL
      END AS threat
    FROM mfn_returns m
    LEFT JOIN LATERAL (
      SELECT pr.id, pr."processedAt", pr."processedOutcome"
      FROM process_returns pr
      WHERE pr."trackingNumber" = m."trackingNumber"
      ORDER BY pr."createdAt" DESC
      LIMIT 1
    ) p ON TRUE
    WHERE m."trackingNumber" IS NOT NULL
  )
`

interface Row {
  id: string
  orderId: string
  trackingNumber: string | null
  returnCarrier: string | null
  carrierStatus: string | null
  trackingUpdatedAt: Date | null
  returnDate: Date | null
  deliveredAt: Date | null
  processedAt: Date | null
  processedOutcome: string | null
  processed: boolean
  statusGroup: string
  threat: string | null
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = req.nextUrl
    const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize = Math.min(500, Math.max(1, Number(searchParams.get('limit') ?? '50')))
    const offset = (page - 1) * pageSize
    const view = searchParams.get('view') ?? 'all'
    const search = searchParams.get('search')?.trim()

    // View filter on the computed columns
    let viewCond = Prisma.sql`TRUE`
    switch (view) {
      case 'threats': viewCond = Prisma.sql`threat IS NOT NULL`; break
      case 'unprocessed_delivered': viewCond = Prisma.sql`threat = 'unprocessed_delivered'`; break
      case 'lost_in_transit': viewCond = Prisma.sql`threat = 'lost_in_transit'`; break
      case 'needs_status': viewCond = Prisma.sql`"statusGroup" = 'needs_status'`; break
      case 'not_tendered': viewCond = Prisma.sql`"statusGroup" = 'not_tendered'`; break
      case 'in_transit': viewCond = Prisma.sql`"statusGroup" = 'in_transit'`; break
      case 'delivered': viewCond = Prisma.sql`"statusGroup" = 'delivered'`; break
    }

    const searchCond = search
      ? Prisma.sql`AND ("orderId" ILIKE ${'%' + search + '%'} OR "trackingNumber" ILIKE ${'%' + search + '%'})`
      : Prisma.empty

    const whereCond = Prisma.sql`WHERE ${viewCond} ${searchCond}`

    const [rows, countRows, summaryRows] = await Promise.all([
      prisma.$queryRaw<Row[]>`
        ${classifiedCte}
        SELECT * FROM classified
        ${whereCond}
        ORDER BY
          CASE
            WHEN threat = 'unprocessed_delivered' THEN 0
            WHEN threat = 'lost_in_transit' THEN 1
            WHEN "statusGroup" = 'needs_status' THEN 2
            ELSE 3
          END,
          COALESCE("deliveredAt", "returnDate") DESC NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      prisma.$queryRaw<{ count: bigint }[]>`
        ${classifiedCte}
        SELECT count(*)::bigint AS count FROM classified ${whereCond}
      `,
      prisma.$queryRaw<{
        total: bigint
        unprocessed_delivered: bigint
        lost_in_transit: bigint
        needs_status: bigint
        not_tendered: bigint
        on_track: bigint
      }[]>`
        ${classifiedCte}
        SELECT
          count(*)::bigint AS total,
          count(*) FILTER (WHERE threat = 'unprocessed_delivered')::bigint AS unprocessed_delivered,
          count(*) FILTER (WHERE threat = 'lost_in_transit')::bigint AS lost_in_transit,
          count(*) FILTER (WHERE "statusGroup" = 'needs_status')::bigint AS needs_status,
          count(*) FILTER (WHERE "statusGroup" = 'not_tendered')::bigint AS not_tendered,
          count(*) FILTER (WHERE threat IS NULL AND "statusGroup" NOT IN ('needs_status','not_tendered'))::bigint AS on_track
        FROM classified
      `,
    ])

    const total = Number(countRows[0]?.count ?? 0)
    const s = summaryRows[0]
    const summary = {
      total: Number(s?.total ?? 0),
      unprocessedDelivered: Number(s?.unprocessed_delivered ?? 0),
      lostInTransit: Number(s?.lost_in_transit ?? 0),
      needsStatus: Number(s?.needs_status ?? 0),
      notTendered: Number(s?.not_tendered ?? 0),
      onTrack: Number(s?.on_track ?? 0),
    }

    return NextResponse.json({
      data: rows,
      summary,
      slaDays: { delivery: DELIVERY_SLA_DAYS, transit: TRANSIT_SLA_DAYS },
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch (err) {
    console.error('[GET /api/incoming-return-labels] Unhandled error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = (await req.json()) as { id?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const ret = await prisma.mFNReturn.findUnique({
    where: { id },
    select: { id: true, trackingNumber: true },
  })
  if (!ret) return NextResponse.json({ error: 'Return not found' }, { status: 404 })
  if (!ret.trackingNumber) {
    return NextResponse.json({ error: 'No tracking number on this return' }, { status: 400 })
  }

  try {
    const result = await getCarrierStatus(ret.trackingNumber)

    await prisma.mFNReturn.update({
      where: { id },
      data: {
        carrierStatus: result.status,
        deliveredAt: result.deliveredAt,
        estimatedDelivery: result.estimatedDelivery,
        trackingUpdatedAt: new Date(),
      },
    })

    return NextResponse.json({
      carrierStatus: result.status,
      deliveredAt: result.deliveredAt,
      trackingUpdatedAt: new Date(),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Tracking lookup failed'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
