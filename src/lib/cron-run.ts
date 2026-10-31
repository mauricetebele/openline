/**
 * Cron run tracking + registry — powers the Cron Status panel.
 *
 * `runCron(name, fn)` wraps a cron's work: it records a CronRun (RUNNING →
 * COMPLETED/FAILED), times it, and lets the work report progress/summary.
 *
 * CRON_REGISTRY mirrors the schedules in vercel.json so the panel can list every
 * cron (even never-run ones) and compute the next scheduled fire time.
 */
import { prisma } from '@/lib/prisma'

export interface CronRunHandle {
  id: string
  /** Update the progress bar + status line while running. */
  progress: (current: number, total?: number | null, detail?: string) => Promise<void>
  /** Set a short detail/status line without touching progress counters. */
  setDetail: (detail: string) => Promise<void>
}

export async function runCron<T>(
  name: string,
  fn: (run: CronRunHandle) => Promise<T>,
  opts?: { trigger?: string; summarize?: (result: T) => string },
): Promise<T> {
  const run = await prisma.cronRun.create({
    data: { name, status: 'RUNNING', trigger: opts?.trigger ?? 'cron' },
  })
  const handle: CronRunHandle = {
    id: run.id,
    progress: async (current, total, detail) => {
      await prisma.cronRun.update({
        where: { id: run.id },
        data: {
          progressCurrent: current,
          ...(total != null ? { progressTotal: total } : {}),
          ...(detail ? { detail } : {}),
        },
      }).catch(() => {})
    },
    setDetail: async (detail) => {
      await prisma.cronRun.update({ where: { id: run.id }, data: { detail } }).catch(() => {})
    },
  }
  const start = Date.now()
  try {
    const result = await fn(handle)
    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        durationMs: Date.now() - start,
        summary: opts?.summarize ? opts.summarize(result).slice(0, 2000) : safeSummary(result),
      },
    }).catch(() => {})
    return result
  } catch (err) {
    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        durationMs: Date.now() - start,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
      },
    }).catch(() => {})
    throw err
  }
}

function safeSummary(result: unknown): string | null {
  if (result == null) return null
  try {
    const s = typeof result === 'string' ? result : JSON.stringify(result)
    return s.slice(0, 2000)
  } catch { return null }
}

// ─── Registry (mirrors vercel.json "crons") ──────────────────────────────────
export interface CronDef { name: string; schedule: string; description: string }

export const CRON_REGISTRY: CronDef[] = [
  { name: 'sync-orders',              schedule: '*/10 * * * *',  description: 'Sync Amazon MFN + BackMarket orders' },
  { name: 'push-qty',                 schedule: '*/10 * * * *',  description: 'Push available quantity to marketplaces' },
  { name: 'refresh-pricing',          schedule: '*/30 * * * *',  description: 'Refresh live price + Buy Box / BackBox' },
  { name: 'backup-db',                schedule: '0 0 * * *',     description: 'Nightly database backup' },
  { name: 'import',                   schedule: '',              description: 'Refund import (retired)' },
  { name: 'sync-fba-refunds',         schedule: '0 */6 * * *',   description: 'Sync FBA reimbursements' },
  { name: 'sync-fba-returns',         schedule: '0 8 * * *',     description: 'Sync FBA customer returns' },
  { name: 'sync-commissions',         schedule: '10 */6 * * *',  description: 'Sync marketplace commissions' },
  { name: 'reconcile-qty',            schedule: '0 0 * * *',     description: 'Reconcile inventory quantities' },
  { name: 'sync-fba-inventory',       schedule: '20 */6 * * *',  description: 'Sync FBA inventory levels' },
  { name: 'sync-replacements',        schedule: '30 */6 * * *',  description: 'Sync free-replacement orders' },
  { name: 'sync-fba-orders',          schedule: '0 */4 * * *',   description: 'Sync FBA (AFN) shipped orders' },
  { name: 'sync-mfn-returns',         schedule: '0 6 * * *',     description: 'Sync MFN returns' },
  { name: 'sync-transactions',        schedule: '50 */6 * * *',  description: 'Sync financial transactions' },
  { name: 'review-amazon-refunds',    schedule: '0 5 * * *',     description: 'Auto-review Amazon refunds' },
  { name: 'sync-competitive-offers',  schedule: '40 * * * *',    description: 'Sync competitive offers' },
  { name: 'listing-uptime',           schedule: '15,45 * * * *', description: 'Record Amazon listing uptime' },
]

// Next fire time (UTC, ms) for a 5-field cron expression, stepping minute-by-minute.
// Supports the minute/hour field forms used in vercel.json: star, step (star-slash-N),
// exact (M), and comma lists (M1,M2). Day-of-month / month / day-of-week are treated
// as star (all our crons use star there). Returns null for an empty/retired schedule.
export function nextCronFire(expr: string, fromMs: number): number | null {
  if (!expr || !expr.trim()) return null
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 2) return null
  const [minField, hourField] = parts

  const matchField = (field: string, value: number, max: number): boolean => {
    if (field === '*') return true
    for (const token of field.split(',')) {
      if (token.startsWith('*/')) {
        const step = parseInt(token.slice(2), 10)
        if (step > 0 && value % step === 0) return true
      } else if (/^\d+$/.test(token)) {
        if (parseInt(token, 10) === value) return true
      }
      void max
    }
    return false
  }

  // Start from the next whole minute.
  const d = new Date(Math.ceil((fromMs + 1) / 60000) * 60000)
  for (let i = 0; i < 48 * 60; i++) { // search up to 48h ahead
    if (matchField(minField, d.getUTCMinutes(), 59) && matchField(hourField, d.getUTCHours(), 23)) {
      return d.getTime()
    }
    d.setUTCMinutes(d.getUTCMinutes() + 1)
  }
  return null
}
