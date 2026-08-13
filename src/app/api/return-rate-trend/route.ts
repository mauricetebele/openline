/**
 * GET /api/return-rate-trend
 *
 * Time-series return rate for merchant-fulfilled marketplace orders (FBM only —
 * excludes FBA/AFN and free replacement orders), with the sales denominator
 * OFFSET backward by the average ship→return lag so each period's returns are
 * divided by the sales cohort that (on average) produced them. This removes the
 * volume-skew that makes the naive return rate dip after a sales spike.
 *
 *   adjustedRate(period P) = unitsReturned(P) / unitsShipped(P − offset)
 *   naiveRate(period P)    = unitsReturned(P) / unitsShipped(P)
 *
 * The offset is the mean gap between shippedAt and the RMA date, computed live
 * from the data (falls back to 23 days if none).
 *
 * Query: startDate, endDate (YYYY-MM-DD), channel (all|amazon|backmarket),
 *        granularity (week|month)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const DAY = 86_400_000

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const channel = searchParams.get('channel') || 'all'
  const granularity = searchParams.get('granularity') === 'month' ? 'month' : 'week'
  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  const channelCond = (channel === 'amazon' || channel === 'backmarket')
    ? Prisma.sql`AND o."orderSource" = ${channel}`
    : Prisma.empty

  // ── Mean ship→return lag (days) — recomputed automatically on a WEEKLY
  // cadence. The window is anchored to the start of the current ISO week and
  // spans the trailing 52 weeks, so the offset is stable within a week, shifts
  // every Monday, and adapts to recent return behavior. Falls back to all-time
  // if the trailing window is empty (e.g. a quiet channel).
  const nowMs = Date.now()
  const nowDow = (new Date(nowMs).getUTCDay() + 6) % 7 // 0 = Monday
  const weekStartMs = Date.parse(new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00Z') - nowDow * DAY
  const offsetWindowWeeks = 52
  const offsetWindowStart = new Date(weekStartMs - offsetWindowWeeks * 7 * DAY)
  const offsetWindowEnd = new Date(weekStartMs)

  const fbmLag = Prisma.sql`
    FROM marketplace_rmas r
    JOIN orders o ON o.id = r."orderId"
    WHERE o."shippedAt" IS NOT NULL
      AND (o."fulfillmentChannel" IS NULL OR o."fulfillmentChannel" <> 'AFN')
      AND (o."isReplacement" IS NOT TRUE)
      ${channelCond}`
  const offsetRows = await prisma.$queryRaw<{ mean_days: number | null }[]>`
    SELECT COALESCE(
      (SELECT AVG(EXTRACT(EPOCH FROM (r."createdAt" - o."shippedAt")) / 86400.0)
       ${fbmLag} AND r."createdAt" >= ${offsetWindowStart} AND r."createdAt" < ${offsetWindowEnd}),
      (SELECT AVG(EXTRACT(EPOCH FROM (r."createdAt" - o."shippedAt")) / 86400.0) ${fbmLag})
    ) AS mean_days`
  const meanOffsetDays = Math.max(0, Math.round(Number(offsetRows[0]?.mean_days ?? 23)))
  const offsetAsOf = new Date(weekStartMs).toISOString().slice(0, 10)

  const dateFrom = new Date(startDate + 'T00:00:00Z')
  const toExclusive = new Date(Date.parse(endDate + 'T00:00:00Z') + DAY)
  // Sales must be fetched starting `offset` days before the range so the shifted
  // denominator has data for the earliest buckets.
  const shippedFrom = new Date(dateFrom.getTime() - meanOffsetDays * DAY)

  // ── Daily unit tallies (UTC day) ─────────────────────────────────────────
  const [shippedRows, returnedRows] = await Promise.all([
    prisma.$queryRaw<{ d: string; units: number }[]>`
      SELECT (o."shippedAt")::date::text AS d, SUM(oi."quantityOrdered")::int AS units
      FROM orders o
      JOIN order_items oi ON oi."orderId" = o.id
      WHERE o."workflowStatus" = 'SHIPPED'
        AND (o."fulfillmentChannel" IS NULL OR o."fulfillmentChannel" <> 'AFN')
        AND (o."isReplacement" IS NOT TRUE)
        AND o."shippedAt" >= ${shippedFrom} AND o."shippedAt" < ${toExclusive}
        ${channelCond}
      GROUP BY 1`,
    prisma.$queryRaw<{ d: string; units: number }[]>`
      SELECT (r."createdAt")::date::text AS d, SUM(mi."quantityReturned")::int AS units
      FROM marketplace_rmas r
      JOIN orders o ON o.id = r."orderId"
      JOIN marketplace_rma_items mi ON mi."rmaId" = r.id
      WHERE (o."fulfillmentChannel" IS NULL OR o."fulfillmentChannel" <> 'AFN')
        AND (o."isReplacement" IS NOT TRUE)
        AND r."createdAt" >= ${dateFrom} AND r."createdAt" < ${toExclusive}
        ${channelCond}
      GROUP BY 1`,
  ])

  const shippedByDay = new Map<string, number>()
  for (const r of shippedRows) shippedByDay.set(r.d, Number(r.units))
  const returnedByDay = new Map<string, number>()
  for (const r of returnedRows) returnedByDay.set(r.d, Number(r.units))

  const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const bucketKey = (ms: number): string => {
    if (granularity === 'month') return new Date(ms).toISOString().slice(0, 7) // YYYY-MM
    const dow = (new Date(ms).getUTCDay() + 6) % 7 // 0 = Monday
    return isoDay(ms - dow * DAY) // Monday of the week
  }

  const startMs = Date.parse(startDate + 'T00:00:00Z')
  const endMs = Date.parse(endDate + 'T00:00:00Z')
  const bmap = new Map<string, { returned: number; soldOffset: number; soldNaive: number }>()
  for (let t = startMs; t <= endMs; t += DAY) {
    const key = bucketKey(t)
    let b = bmap.get(key)
    if (!b) { b = { returned: 0, soldOffset: 0, soldNaive: 0 }; bmap.set(key, b) }
    b.returned += returnedByDay.get(isoDay(t)) ?? 0
    b.soldNaive += shippedByDay.get(isoDay(t)) ?? 0
    b.soldOffset += shippedByDay.get(isoDay(t - meanOffsetDays * DAY)) ?? 0
  }

  const rate = (num: number, den: number) => den > 0 ? Math.round((num / den) * 1000) / 10 : null
  const series = Array.from(bmap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([bucket, b]) => ({
      bucket,
      unitsReturned: b.returned,
      unitsSoldOffset: b.soldOffset,
      unitsSoldNaive: b.soldNaive,
      adjustedRate: rate(b.returned, b.soldOffset),
      naiveRate: rate(b.returned, b.soldNaive),
    }))

  const totReturned = series.reduce((s, r) => s + r.unitsReturned, 0)
  const totSoldOffset = series.reduce((s, r) => s + r.unitsSoldOffset, 0)
  const totSoldNaive = series.reduce((s, r) => s + r.unitsSoldNaive, 0)

  return NextResponse.json({
    meanOffsetDays,
    offsetAsOf,
    offsetWindowWeeks,
    granularity,
    series,
    overall: {
      unitsReturned: totReturned,
      adjustedRate: rate(totReturned, totSoldOffset),
      naiveRate: rate(totReturned, totSoldNaive),
    },
  })
}
