/**
 * Incoming Amazon (MFN) returns that have a return mailing label tracking
 * number, classified against the processing-SLA threat model.
 *
 * Goal: process every return that lands here within 4 calendar days of delivery.
 *
 * Threat model (per ops):
 *   - not tendered to UPS (label made, no movement) ............ NOT a threat
 *   - has movement but not delivered within 7 days of shipping . lost in transit  → THREAT
 *   - delivered but not resolved within 4 calendar days of
 *     delivery ................................................ auto-refund risk → THREAT
 *
 * A return is "resolved" (threat cleared) once the units are back in our system,
 * via either:
 *   - processed in Process Returns — matched by tracking number against the
 *     process_returns table (a ProcessReturn carries the package's trackingNumber), or
 *   - a Marketplace RMA for the order marked RECEIVED (units received in our system).
 *
 * GET  — paginated, filterable grid data + whole-dataset summary counts.
 * POST — refresh the live carrier status for one return by id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { getCarrierStatus } from '@/lib/ups-tracking'

// Bulk tracking refresh makes several sequential UPS calls; allow headroom.
export const maxDuration = 60

const DELIVERY_SLA_DAYS = 4 // process within N calendar days of delivery
const TRANSIT_SLA_DAYS = 7 // delivered within N days of shipping, else "lost"
const MAX_BATCH = 25 // cap tracking refreshes per POST so the request can't time out

/**
 * Classification CTE shared by the data and summary queries. Produces, per
 * incoming return that has a tracking number:
 *   statusGroup:  delivered | in_transit | not_tendered | needs_status | unknown
 *   processed:    a process_returns row exists for this tracking number
 *   received:     a Marketplace RMA for this order is marked RECEIVED
 *   disposition:  resolved | threat_unprocessed | threat_lost | not_tendered
 *                 | needs_status | on_track
 *
 * disposition is the single source of truth for threat/filtering/summary.
 * A resolved return (processed OR received) is never a threat.
 */
const classifiedCte = Prisma.sql`
  WITH base AS (
    SELECT
      m.id,
      m."orderId",
      m."trackingNumber",
      m."returnCarrier",
      m."carrierStatus",
      m."trackingUpdatedAt",
      m."returnDate",
      m."deliveredAt",
      m."tenderedAt",
      m."threatArchivedAt",
      m."threatArchivedByLabel",
      m."threatArchiveNote",
      p."processedAt"      AS "processedAt",
      p."processedOutcome" AS "processedOutcome",
      (p.id IS NOT NULL)   AS processed,
      EXISTS (
        SELECT 1 FROM marketplace_rmas mr
        JOIN orders o ON o.id = mr."orderId"
        WHERE o."amazonOrderId" = m."orderId"
          AND mr.status = 'RECEIVED'
      ) AS received,
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
      END AS "statusGroup"
    FROM mfn_returns m
    LEFT JOIN LATERAL (
      SELECT pr.id, pr."processedAt", pr."processedOutcome"
      FROM process_returns pr
      WHERE pr."trackingNumber" = m."trackingNumber"
      ORDER BY pr."createdAt" DESC
      LIMIT 1
    ) p ON TRUE
    WHERE m."trackingNumber" IS NOT NULL
  ),
  classified AS (
    SELECT base.*,
      CASE
        WHEN processed OR received THEN 'resolved'
        WHEN "threatArchivedAt" IS NOT NULL THEN 'archived'
        WHEN "statusGroup" = 'delivered'
          AND "deliveredAt" IS NOT NULL
          AND "deliveredAt" < now() - (${DELIVERY_SLA_DAYS} || ' days')::interval
          THEN 'threat_unprocessed'
        WHEN "statusGroup" = 'in_transit'
          AND "tenderedAt" IS NOT NULL
          AND "tenderedAt" < now() - (${TRANSIT_SLA_DAYS} || ' days')::interval
          THEN 'threat_lost'
        WHEN "statusGroup" = 'not_tendered' THEN 'not_tendered'
        WHEN "statusGroup" = 'needs_status' THEN 'needs_status'
        ELSE 'on_track'
      END AS disposition
    FROM base
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
  tenderedAt: Date | null
  threatArchivedAt: Date | null
  threatArchivedByLabel: string | null
  threatArchiveNote: string | null
  processedAt: Date | null
  processedOutcome: string | null
  processed: boolean
  received: boolean
  statusGroup: string
  disposition: string
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

    // Id list of rows whose tender date needs a UPS pull: in-transit without a
    // captured tender date, or no status yet. Used by the bulk-refresh button.
    if (searchParams.get('refreshable') === '1') {
      const ids = await prisma.$queryRaw<{ id: string }[]>`
        ${classifiedCte}
        SELECT id FROM classified
        WHERE NOT (processed OR received)
          AND (("statusGroup" = 'in_transit' AND "tenderedAt" IS NULL)
               OR "statusGroup" = 'needs_status')
        ORDER BY COALESCE("returnDate", now()) DESC
        LIMIT 2000
      `
      return NextResponse.json({ ids: ids.map(r => r.id) })
    }

    // View filter on the computed disposition
    let viewCond = Prisma.sql`TRUE`
    switch (view) {
      case 'threats': viewCond = Prisma.sql`disposition IN ('threat_unprocessed','threat_lost')`; break
      case 'unprocessed_delivered': viewCond = Prisma.sql`disposition = 'threat_unprocessed'`; break
      case 'lost_in_transit': viewCond = Prisma.sql`disposition = 'threat_lost'`; break
      case 'needs_status': viewCond = Prisma.sql`disposition = 'needs_status'`; break
      case 'not_tendered': viewCond = Prisma.sql`disposition = 'not_tendered'`; break
      case 'resolved': viewCond = Prisma.sql`disposition = 'resolved'`; break
      case 'archived': viewCond = Prisma.sql`disposition = 'archived'`; break
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
          CASE disposition
            WHEN 'threat_unprocessed' THEN 0
            WHEN 'threat_lost' THEN 1
            WHEN 'needs_status' THEN 2
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
        resolved: bigint
        archived: bigint
        on_track: bigint
      }[]>`
        ${classifiedCte}
        SELECT
          count(*)::bigint AS total,
          count(*) FILTER (WHERE disposition = 'threat_unprocessed')::bigint AS unprocessed_delivered,
          count(*) FILTER (WHERE disposition = 'threat_lost')::bigint AS lost_in_transit,
          count(*) FILTER (WHERE disposition = 'needs_status')::bigint AS needs_status,
          count(*) FILTER (WHERE disposition = 'not_tendered')::bigint AS not_tendered,
          count(*) FILTER (WHERE disposition = 'resolved')::bigint AS resolved,
          count(*) FILTER (WHERE disposition = 'archived')::bigint AS archived,
          count(*) FILTER (WHERE disposition = 'on_track')::bigint AS on_track
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
      resolved: Number(s?.resolved ?? 0),
      archived: Number(s?.archived ?? 0),
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

  const body = (await req.json()) as { id?: string; ids?: string[] }

  // Batch refresh — used by the bulk "Refresh in-transit & no-status" button.
  if (Array.isArray(body.ids)) {
    const ids = body.ids.slice(0, MAX_BATCH)
    const rets = await prisma.mFNReturn.findMany({
      where: { id: { in: ids }, trackingNumber: { not: null } },
      select: { id: true, trackingNumber: true },
    })
    let refreshed = 0
    let failed = 0
    for (const ret of rets) {
      try {
        const result = await getCarrierStatus(ret.trackingNumber!)
        await prisma.mFNReturn.update({
          where: { id: ret.id },
          data: {
            carrierStatus: result.status,
            deliveredAt: result.deliveredAt,
            estimatedDelivery: result.estimatedDelivery,
            trackingUpdatedAt: new Date(),
            ...(result.shippedAt ? { tenderedAt: result.shippedAt } : {}),
          },
        })
        refreshed++
      } catch {
        failed++
      }
    }
    return NextResponse.json({ refreshed, failed, processed: rets.length })
  }

  const id = body.id
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
        // Only set once known; never clobber a captured tender date with null
        ...(result.shippedAt ? { tenderedAt: result.shippedAt } : {}),
      },
    })

    return NextResponse.json({
      carrierStatus: result.status,
      deliveredAt: result.deliveredAt,
      tenderedAt: result.shippedAt,
      trackingUpdatedAt: new Date(),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Tracking lookup failed'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}

/**
 * PATCH — archive a threat (mark as handled outside the system) or un-archive it.
 * Body: { id, action: 'archive' | 'unarchive', note? }
 */
export async function PATCH(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, action, note } = (await req.json()) as {
    id?: string
    action?: 'archive' | 'unarchive'
    note?: string
  }
  if (!id || (action !== 'archive' && action !== 'unarchive')) {
    return NextResponse.json({ error: "id and action ('archive'|'unarchive') required" }, { status: 400 })
  }

  const data = action === 'archive'
    ? {
        threatArchivedAt: new Date(),
        threatArchivedByLabel: user.name || user.email,
        threatArchiveNote: note?.trim() || null,
      }
    : {
        threatArchivedAt: null,
        threatArchivedByLabel: null,
        threatArchiveNote: null,
      }

  const updated = await prisma.mFNReturn.update({
    where: { id },
    data,
    select: { id: true, threatArchivedAt: true, threatArchivedByLabel: true, threatArchiveNote: true },
  })

  return NextResponse.json({ ok: true, ...updated })
}
