/**
 * POST /api/oli/sync
 *
 * Streams real-time progress as newline-delimited JSON while syncing
 * all OLI strategy SKUs from Amazon SP-API.
 *
 * Phase 1 (listings): status, ASIN, price, qty   — 5 req/s
 * Phase 2 (buy box):  buy box price + winner      — 0.5 req/s
 *
 * Each line is a JSON object:
 *   { phase, current, total, label, done? }
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { syncOliListings, syncOliBuyBox, SyncProgress } from '@/lib/oli/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: SyncProgress) {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'))
      }

      // Phase 1: Listings (fast)
      await syncOliListings(send)

      // Phase 2: Buy Box (slow)
      await syncOliBuyBox(send)

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  })
}
