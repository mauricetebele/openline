/**
 * Temporary debug endpoint — fetches one Back Market order and returns all API fields.
 * DELETE THIS FILE after inspecting the response.
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from '@/lib/backmarket/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const credential = await prisma.backMarketCredential.findFirst({
    where: { isActive: true },
    select: { apiKeyEnc: true },
  })
  if (!credential) return NextResponse.json({ error: 'No BM credential' }, { status: 404 })

  const client = new BackMarketClient(decrypt(credential.apiKeyEnc))
  const resp = await client.get<{ results?: unknown[] }>('/orders', { state: 1, page: 1 })
  const firstOrder = resp.results?.[0]

  if (!firstOrder) {
    // Try state 3 if no state 1 orders
    const resp3 = await client.get<{ results?: unknown[] }>('/orders', { state: 3, page: 1 })
    const first3 = resp3.results?.[0]
    if (!first3) return NextResponse.json({ error: 'No orders found' }, { status: 404 })
    return NextResponse.json({ keys: Object.keys(first3 as Record<string, unknown>), sample: first3 })
  }

  return NextResponse.json({ keys: Object.keys(firstOrder as Record<string, unknown>), sample: firstOrder })
}
