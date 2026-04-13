import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { getCarrierStatus } from '@/lib/ups-tracking'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const trackingNumbers: string[] = body.trackingNumbers ?? []

  if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
    return NextResponse.json({ error: 'trackingNumbers array is required' }, { status: 400 })
  }

  if (trackingNumbers.length > 20) {
    return NextResponse.json({ error: 'Maximum 20 tracking numbers per request' }, { status: 400 })
  }

  // Process 5 at a time — retry-with-backoff in getCarrierStatus handles 429s
  const CONCURRENCY = 5
  const results: Record<string, { status: string; deliveredAt: Date | null; estimatedDelivery: Date | null } | { error: string }> = {}

  let running = 0
  const waitQueue: (() => void)[] = []
  async function acquireSlot() {
    if (running >= CONCURRENCY) await new Promise<void>(r => waitQueue.push(r))
    running++
  }
  function releaseSlot() {
    running--
    const next = waitQueue.shift()
    if (next) next()
  }

  await Promise.allSettled(
    trackingNumbers.map(async (tn) => {
      await acquireSlot()
      try {
        results[tn] = await getCarrierStatus(tn)
      } catch (err) {
        results[tn] = { error: err instanceof Error ? err.message : 'Unknown error' }
      } finally {
        releaseSlot()
      }
    }),
  )

  return NextResponse.json({ results })
}
