/**
 * cronGet(name, work) — builds a Vercel-cron GET handler that:
 *   1. verifies the CRON_SECRET bearer token,
 *   2. records a CronRun (RUNNING → COMPLETED/FAILED) via runCron,
 *   3. returns the work's result as JSON (or a 500 on failure).
 *
 * `work` receives (req, run); `run.progress()` updates the live progress bar.
 * Return a plain object to serialize as the response body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runCron, type CronRunHandle } from '@/lib/cron-run'

export function cronGet(
  name: string,
  work: (req: NextRequest, run: CronRunHandle) => Promise<unknown>,
) {
  return async function GET(req: NextRequest) {
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    try {
      const result = await runCron(name, (run) => work(req, run))
      return NextResponse.json((result ?? { ok: true }) as Record<string, unknown>)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'cron failed' }, { status: 500 })
    }
  }
}
