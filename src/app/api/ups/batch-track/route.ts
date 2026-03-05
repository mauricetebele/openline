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

  const settled = await Promise.allSettled(
    trackingNumbers.map(async (tn) => {
      const result = await getCarrierStatus(tn)
      return { tn, result }
    }),
  )

  const results: Record<string, { status: string; deliveredAt: Date | null; estimatedDelivery: Date | null } | { error: string }> = {}

  for (const entry of settled) {
    if (entry.status === 'fulfilled') {
      results[entry.value.tn] = entry.value.result
    } else {
      const tn = trackingNumbers[settled.indexOf(entry)]
      results[tn] = { error: entry.reason?.message ?? 'Unknown error' }
    }
  }

  return NextResponse.json({ results })
}
