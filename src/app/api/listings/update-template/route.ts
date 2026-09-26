/**
 * POST /api/listings/update-template
 * Body: { accountId: string, skus: string[], templateName: string }
 * Returns: { jobId: string }  — processing runs in the background immediately.
 *
 * GET /api/listings/update-template?jobId=xxx
 * Returns the TemplateBatchJob record (status, processed, updated, failedSkus, …)
 *
 * SKUs are patched with a small concurrency pool (each iteration is a GET + PATCH;
 * the SP-API client retries 429/503 with exponential backoff, so a few in parallel
 * self-throttle). Progress is flushed to the DB every 10 SKUs so the polling UI
 * stays current.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { updateShippingTemplate, resolveTemplateGroupId } from '@/lib/amazon/listings'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

const postSchema = z.object({
  accountId: z.string().min(1),
  skus: z.array(z.string().min(1)).min(1),
  templateName: z.string().min(1),
})

// ─── GET — poll job status ────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const jobId = req.nextUrl.searchParams.get('jobId')
    if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

    const job = await prisma.templateBatchJob.findUnique({ where: { id: jobId } })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    return NextResponse.json(job)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[GET /api/listings/update-template]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── POST — create job and start background processing ───────────────────────

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const adminErr = requireAdmin(user)
    if (adminErr) return adminErr

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = postSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
    }

    const { accountId, skus, templateName } = parsed.data

    // Create the job record — status starts as RUNNING
    const job = await prisma.templateBatchJob.create({
      data: {
        accountId,
        templateName,
        totalSkus: skus.length,
        processed: 0,
        updated: 0,
        failedSkus: [],
      },
    })

    // ── Background processing — do NOT await ───────────────────────────────
    ;(async () => {
      let updated = 0
      const failedSkus: { sku: string; error: string }[] = []

      // Resolve the internal UUID once — Amazon requires it, not the display name
      let templateGroupId: string | undefined
      try {
        templateGroupId = await resolveTemplateGroupId(accountId, templateName)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        await prisma.templateBatchJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            errorMessage: `Could not resolve template UUID: ${message}`,
            completedAt: new Date(),
          },
        })
        return
      }

      // Process with a small concurrency pool instead of strictly serial. Each SKU
      // is a GET + PATCH; the SP-API client already retries 429/503 with
      // exponential backoff, so running a few in parallel self-throttles if Amazon
      // pushes back — roughly 3–4× faster than the old serial + 400ms-gap loop.
      const CONCURRENCY = 4
      let processed = 0
      let nextIdx = 0

      async function flush() {
        await prisma.templateBatchJob.update({
          where: { id: job.id },
          data: { processed, updated, failedSkus },
        }).catch(() => { /* ignore transient flush errors */ })
      }

      async function worker() {
        while (nextIdx < skus.length) {
          const sku = skus[nextIdx++]
          try {
            await updateShippingTemplate(accountId, sku, templateName, templateGroupId)
            updated++
          } catch (err: unknown) {
            failedSkus.push({ sku, error: err instanceof Error ? err.message : String(err) })
          }
          processed++
          // Flush progress every 10 SKUs so the polling client sees smooth updates
          if (processed % 10 === 0 || processed === skus.length) await flush()
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, skus.length) }, worker))

      await prisma.templateBatchJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          processed: skus.length,
          updated,
          failedSkus,
          completedAt: new Date(),
        },
      })
    })().catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[TemplateBatchJob] Unexpected error in job', job.id, message)
      await prisma.templateBatchJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      }).catch(() => { /* ignore — server may be shutting down */ })
    })

    return NextResponse.json({ jobId: job.id }, { status: 202 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/listings/update-template]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
