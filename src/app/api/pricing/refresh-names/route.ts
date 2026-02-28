/**
 * POST /api/pricing/refresh-names
 * Body: { accountId: string }
 *
 * Resolves seller names for every unique competitor seller ID stored for this
 * account. Null-cached entries are retried (debug-seller endpoint clears them
 * before fetching). Returns a count of how many names were resolved this run.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { fetchSellerNameDebug } from '@/lib/amazon/seller-name'
import { requireAdmin } from '@/lib/auth-helpers'

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const adminErr = requireAdmin(user)
    if (adminErr) return adminErr

    const { accountId } = await req.json()
    if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

    const account = await prisma.amazonAccount.findUnique({ where: { id: accountId } })
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    // Collect all distinct seller IDs from competitive offers for this account
    const rows = await prisma.competitiveOffer.findMany({
      where: { accountId },
      select: { sellerId: true },
      distinct: ['sellerId'],
    })

    const sellerIds = rows
      .map((r) => r.sellerId)
      .filter((id) => id && id !== 'unknown')

    if (sellerIds.length === 0) {
      return NextResponse.json({ resolved: 0, total: 0, message: 'No seller IDs found. Sync your catalog first.' })
    }

    // Clear any stale null entries so we get a fresh attempt for each
    await prisma.sellerProfile.deleteMany({
      where: { sellerId: { in: sellerIds }, name: null },
    })

    // Resolve each seller name (sequential with 1.2 s delay to avoid rate-limiting)
    let resolved = 0
    for (let i = 0; i < sellerIds.length; i++) {
      const sellerId = sellerIds[i]
      const { name } = await fetchSellerNameDebug(sellerId, account.marketplaceId)
      if (name) {
        resolved++
        await prisma.sellerProfile.upsert({
          where: { sellerId },
          create: { sellerId, name },
          update: { name, fetchedAt: new Date() },
        })
      }
      if (i < sellerIds.length - 1) {
        await new Promise((r) => setTimeout(r, 1_200))
      }
    }

    return NextResponse.json({ resolved, total: sellerIds.length })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/pricing/refresh-names]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
