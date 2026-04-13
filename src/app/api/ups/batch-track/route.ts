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

  // Process sequentially with a small delay to stay under UPS rate limits
  const results: Record<string, { status: string; deliveredAt: Date | null; estimatedDelivery: Date | null } | { error: string }> = {}

  for (const tn of trackingNumbers) {
    try {
      const result = await getCarrierStatus(tn)
      results[tn] = result
    } catch (err) {
      results[tn] = { error: err instanceof Error ? err.message : 'Unknown error' }
    }
    // 600ms between calls — UPS free tier allows ~1 req/sec
    await new Promise(r => setTimeout(r, 600))
  }

  return NextResponse.json({ results })
}
