/**
 * POST /api/listings/assign-group
 *
 * Body: { accountId: string, skus: string[], groupName: string | null }
 *
 * Bulk-assigns (or clears) a local group on a set of SKUs.
 * groupName: null removes the listing from its current group.
 *
 * Response: { updated: number }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

const bodySchema = z.object({
  accountId: z.string().min(1),
  skus: z.array(z.string().min(1)).min(1),
  groupName: z.string().min(1).nullable(),
})

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { accountId, skus, groupName } = parsed.data

  const result = await prisma.sellerListing.updateMany({
    where: { accountId, sku: { in: skus } },
    data: { groupName },
  })

  return NextResponse.json({ updated: result.count })
}
