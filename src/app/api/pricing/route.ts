/**
 * GET /api/pricing
 *
 * Query params:
 *   accountId   string (required)
 *   page        number (default 1)
 *   pageSize    number (default 50, max 5000)
 *   search      string (sku, asin, title — partial match)
 *   channel     'FBA' | 'MFN' (optional, returns all if omitted)
 *
 * Response: { data, pagination }
 * Each listing includes competitorCount and lowestCompetitorLandedPrice.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = req.nextUrl
    const accountId = searchParams.get('accountId')?.trim()
    if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

    const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize = Math.min(5000, Math.max(1, Number(searchParams.get('pageSize') ?? '50')))
    const skip = (page - 1) * pageSize

    const where: Prisma.SellerListingWhereInput = { accountId }

    const search = searchParams.get('search')?.trim()
    if (search) {
      where.OR = [
        { sku: { contains: search, mode: 'insensitive' } },
        { asin: { contains: search, mode: 'insensitive' } },
        { productTitle: { contains: search, mode: 'insensitive' } },
      ]
    }

    const channel = searchParams.get('channel')?.trim()
    if (channel === 'FBA' || channel === 'MFN') {
      where.fulfillmentChannel = channel
    }

    const status = searchParams.get('status')?.trim()
    if (status) where.listingStatus = status

    // Sorting
    const SORTABLE = new Set([
      'sku', 'asin', 'productTitle', 'fulfillmentChannel',
      'listingStatus', 'condition', 'quantity', 'price', 'minPrice', 'maxPrice',
    ])
    const rawSortField = searchParams.get('sortField')?.trim() ?? 'sku'
    const sortField = SORTABLE.has(rawSortField) ? rawSortField : 'sku'
    const sortDir = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc'
    const orderBy = [
      { [sortField]: sortDir } as Prisma.SellerListingOrderByWithRelationInput,
      // secondary sort for stable ordering
      ...(sortField !== 'sku' ? [{ sku: 'asc' } as Prisma.SellerListingOrderByWithRelationInput] : []),
    ]

    const accountFilter: { accountId: string } = { accountId }

    const [total, listings, distinctStatusesRaw] = await Promise.all([
      prisma.sellerListing.count({ where }),
      prisma.sellerListing.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        select: {
          id: true,
          sku: true,
          asin: true,
          productTitle: true,
          condition: true,
          fulfillmentChannel: true,
          listingStatus: true,
          quantity: true,
          price: true,
          minPrice: true,
          maxPrice: true,
          lastSyncedAt: true,
          sold24h: true,
          sold3d: true,
          sold7d: true,
        },
      }),
      prisma.sellerListing.findMany({
        where: { ...accountFilter, listingStatus: { not: null } },
        select: { listingStatus: true },
        distinct: ['listingStatus'],
        orderBy: { listingStatus: 'asc' },
      }),
    ])

    const statuses = distinctStatusesRaw
      .map((r) => r.listingStatus)
      .filter((s): s is string => s !== null)

    // Attach competitive offer summaries for the current page's ASINs
    const pageAsins = [...new Set(
      listings.map((l) => l.asin).filter((a): a is string => a !== null),
    )]

    const offerSummaries =
      pageAsins.length > 0
        ? await prisma.competitiveOffer.groupBy({
            by: ['asin'],
            where: { accountId, asin: { in: pageAsins } },
            _count: { id: true },
            _min: { landedPrice: true },
          })
        : []

    type SummaryMap = { count: number; minPrice: Prisma.Decimal | null }
    const summaryByAsin = new Map<string, SummaryMap>(
      offerSummaries.map((s) => [
        s.asin,
        { count: s._count.id, minPrice: s._min.landedPrice },
      ]),
    )

    const data = listings.map((l) => {
      const summary = l.asin ? summaryByAsin.get(l.asin) : undefined
      return {
        ...l,
        competitorCount: summary?.count ?? 0,
        lowestCompetitorLandedPrice: summary?.minPrice ?? null,
      }
    })

    return NextResponse.json({
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      statuses,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[GET /api/pricing]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
