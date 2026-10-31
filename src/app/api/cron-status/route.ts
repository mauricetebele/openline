/**
 * GET /api/cron-status
 * Admin-only. Returns every cron (from CRON_REGISTRY) with its latest run, recent
 * history, whether it's currently running, and the next scheduled fire time.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { CRON_REGISTRY, nextCronFire } from '@/lib/cron-run'

export const dynamic = 'force-dynamic'

// A RUNNING row older than this is almost certainly a killed/timed-out run.
const STALE_MS = 15 * 60 * 1000

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const now = Date.now()
  const names = CRON_REGISTRY.map(c => c.name)

  // Pull recent runs for all registry crons in one query, newest first.
  const runs = await prisma.cronRun.findMany({
    where: { name: { in: names } },
    orderBy: { startedAt: 'desc' },
    take: 500,
  })
  const byName = new Map<string, typeof runs>()
  for (const r of runs) {
    const list = byName.get(r.name) ?? []
    if (list.length < 15) list.push(r)
    byName.set(r.name, list)
  }

  // For order syncs, enrich a live progress bar from the per-account OrderSyncJob.
  const liveJob = await prisma.orderSyncJob.findFirst({
    where: { status: 'RUNNING' },
    orderBy: { startedAt: 'desc' },
    select: { totalFound: true, totalSynced: true, source: true, trigger: true },
  })

  const crons = CRON_REGISTRY.map(def => {
    const history = byName.get(def.name) ?? []
    const latest = history[0] ?? null
    const isStale = !!latest && latest.status === 'RUNNING' && now - new Date(latest.startedAt).getTime() > STALE_MS
    const running = !!latest && latest.status === 'RUNNING' && !isStale

    let progressCurrent = latest?.progressCurrent ?? null
    let progressTotal = latest?.progressTotal ?? null
    // Order-sync crons: borrow the live job's counts if the CronRun has none.
    if (running && progressTotal == null && liveJob && (def.name === 'sync-orders' || def.name === 'sync-fba-orders')) {
      const matchesSource =
        (def.name === 'sync-fba-orders') ||
        (def.name === 'sync-orders' && (liveJob.trigger === 'cron' || liveJob.trigger === 'cron-full'))
      if (matchesSource && liveJob.totalFound > 0) {
        progressCurrent = liveJob.totalSynced
        progressTotal = liveJob.totalFound
      }
    }

    const nextFireAt = def.schedule ? nextCronFire(def.schedule, now) : null

    return {
      name: def.name,
      description: def.description,
      schedule: def.schedule || null,
      nextFireAt: nextFireAt ? new Date(nextFireAt).toISOString() : null,
      running,
      stale: isStale,
      latest: latest && {
        status: isStale ? 'STALE' : latest.status,
        startedAt: latest.startedAt,
        completedAt: latest.completedAt,
        durationMs: latest.durationMs,
        detail: latest.detail,
        summary: latest.summary,
        error: latest.error,
      },
      progressCurrent,
      progressTotal,
      history: history.map(h => ({
        id: h.id,
        status: h.status === 'RUNNING' && now - new Date(h.startedAt).getTime() > STALE_MS ? 'STALE' : h.status,
        startedAt: h.startedAt,
        completedAt: h.completedAt,
        durationMs: h.durationMs,
        detail: h.detail,
        summary: h.summary,
        error: h.error,
      })),
    }
  })

  // Soonest upcoming fire across all scheduled crons.
  const upcoming = crons
    .filter(c => c.nextFireAt)
    .map(c => ({ name: c.name, nextFireAt: c.nextFireAt! }))
    .sort((a, b) => new Date(a.nextFireAt).getTime() - new Date(b.nextFireAt).getTime())
  const nextOverall = upcoming[0] ?? null

  return NextResponse.json({ crons, nextOverall, serverTime: new Date(now).toISOString() })
}
