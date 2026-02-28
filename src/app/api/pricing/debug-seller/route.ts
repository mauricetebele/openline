/**
 * GET /api/pricing/debug-seller?sellerId=A3SBLQ9AF6CQVD&marketplaceId=ATVPDKIKX0DER
 *
 * Debug endpoint — tries to resolve a seller name and returns exactly what
 * was fetched and parsed so you can see why a name did or didn't match.
 * Remove or restrict this endpoint before going to production.
 */
import { NextRequest, NextResponse } from 'next/server'
import { fetchSellerNameDebug } from '@/lib/amazon/seller-name'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sellerId = req.nextUrl.searchParams.get('sellerId')?.trim()
  const marketplaceId = req.nextUrl.searchParams.get('marketplaceId')?.trim() ?? 'ATVPDKIKX0DER'

  if (!sellerId) return NextResponse.json({ error: 'Missing sellerId' }, { status: 400 })

  // Clear any cached null so this is a fresh attempt
  await prisma.sellerProfile.deleteMany({ where: { sellerId, name: null } })

  const result = await fetchSellerNameDebug(sellerId, marketplaceId)

  if (result.name) {
    await prisma.sellerProfile.upsert({
      where: { sellerId },
      create: { sellerId, name: result.name },
      update: { name: result.name, fetchedAt: new Date() },
    })
  }

  return NextResponse.json({
    sellerId,
    marketplaceId,
    resolvedName: result.name,
    urlFetched: result.url,
    error: result.error ?? null,
    htmlSnippet: result.snippet.slice(0, 600),
  })
}
