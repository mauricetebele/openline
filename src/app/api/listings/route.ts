/**
 * GET /api/listings
 *
 * Query params:
 *   page        number (default 1)
 *   pageSize    number (default 50, max 5000)
 *   accountId   string
 *   search      string (sku, asin, title — partial match)
 *   template    string (exact shipping template name filter)
 *   status      string (exact listing status filter, e.g. Active | Inactive | Incomplete)
 *
 * Response: { data, pagination, templates: string[], statuses: string[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const pageSize = Math.min(5000, Math.max(1, Number(searchParams.get('pageSize') ?? '50')))
  const skip = (page - 1) * pageSize

  // Shipping Templates only applies to MFN listings — FBA listings are managed by Amazon.
  const where: Prisma.SellerListingWhereInput = { fulfillmentChannel: 'MFN' }

  const accountId = searchParams.get('accountId')
  if (accountId) where.accountId = accountId

  const search = searchParams.get('search')?.trim()
  if (search) {
    where.OR = [
      { sku: { contains: search, mode: 'insensitive' } },
      { asin: { contains: search, mode: 'insensitive' } },
      { productTitle: { contains: search, mode: 'insensitive' } },
    ]
  }

  const template = searchParams.get('template')?.trim()
  if (template) where.shippingTemplate = template

  const status = searchParams.get('status')?.trim()
  if (status) where.listingStatus = status

  const group = searchParams.get('group')?.trim()
  if (group === '__none__') where.groupName = null
  else if (group) where.groupName = group

  const accountFilter = accountId ? { accountId } : {}

  const [total, listings, distinctTemplatesRaw, distinctStatusesRaw, distinctGroupsRaw] = await Promise.all([
    prisma.sellerListing.count({ where }),
    prisma.sellerListing.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { sku: 'asc' },
      include: { account: { select: { sellerId: true, marketplaceName: true } } },
    }),
    prisma.sellerListing.findMany({
      where: { ...accountFilter, shippingTemplate: { not: null } },
      select: { shippingTemplate: true },
      distinct: ['shippingTemplate'],
      orderBy: { shippingTemplate: 'asc' },
    }),
    prisma.sellerListing.findMany({
      where: { ...accountFilter, listingStatus: { not: null } },
      select: { listingStatus: true },
      distinct: ['listingStatus'],
      orderBy: { listingStatus: 'asc' },
    }),
    prisma.sellerListing.findMany({
      where: { ...accountFilter, groupName: { not: null } },
      select: { groupName: true },
      distinct: ['groupName'],
      orderBy: { groupName: 'asc' },
    }),
  ])

  const templates = distinctTemplatesRaw
    .map((r) => r.shippingTemplate)
    .filter((t): t is string => t !== null)

  const statuses = distinctStatusesRaw
    .map((r) => r.listingStatus)
    .filter((s): s is string => s !== null)

  const groups = distinctGroupsRaw
    .map((r) => r.groupName)
    .filter((g): g is string => g !== null)

  return NextResponse.json({
    data: listings,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    templates,
    statuses,
    groups,
  })
}
