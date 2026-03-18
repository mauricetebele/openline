/**
 * GET  /api/fba-shipments         — list all FBA shipments
 * POST /api/fba-shipments         — create a new draft shipment (Step 1: items only, no inventory)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { fetchFnsku } from '@/lib/amazon/fba-inbound'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const status = req.nextUrl.searchParams.get('status')
  const q = req.nextUrl.searchParams.get('q')?.trim()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}
  if (status) where.status = status

  if (q) {
    where.OR = [
      { shipmentNumber: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { shipmentConfirmationId: { contains: q, mode: 'insensitive' } },
      { shipmentId: { contains: q, mode: 'insensitive' } },
      { labelData: { contains: q, mode: 'insensitive' } },
      { items: { some: { sellerSku: { contains: q, mode: 'insensitive' } } } },
      { items: { some: { fnsku: { contains: q, mode: 'insensitive' } } } },
      { items: { some: { asin: { contains: q, mode: 'insensitive' } } } },
      { items: { some: { msku: { product: { sku: { contains: q, mode: 'insensitive' } } } } } },
    ]
  }

  const shipments = await prisma.fbaShipment.findMany({
    where,
    select: {
      id: true, status: true, shipmentNumber: true, name: true, accountId: true,
      warehouseId: true, inboundPlanId: true, shipmentId: true, shipmentConfirmationId: true,
      packingGroupId: true, placementFee: true, shippingEstimate: true, labelData: true,
      lastError: true, lastErrorAt: true, createdAt: true, updatedAt: true,
      account: { select: { id: true, sellerId: true, marketplaceName: true } },
      warehouse: { select: { id: true, name: true } },
      items: { include: { msku: { select: { sellerSku: true, product: { select: { sku: true, description: true } } } } } },
      _count: { select: { items: true, boxes: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ data: shipments })
}

// ─── POST ────────────────────────────────────────────────────────────────────

interface CreateItem {
  mskuId?: string | null
  sellerSku?: string
  fnsku?: string
  asin?: string
  quantity: number
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { accountId: string; name?: string; items: CreateItem[] }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { accountId, name, items } = body
  if (!accountId || !items?.length) {
    return NextResponse.json({ error: 'accountId and items are required' }, { status: 400 })
  }

  // Get account for marketplace info
  const account = await prisma.amazonAccount.findUnique({ where: { id: accountId } })
  if (!account) return NextResponse.json({ error: 'Amazon account not found' }, { status: 404 })

  // Resolve each item — either via MSKU ID or direct sellerSku/fnsku/asin
  const itemsData: Array<{ mskuId: string | null; sellerSku: string; fnsku: string; asin: string | null; quantity: number }> = []

  for (const item of items) {
    if (item.mskuId) {
      // Resolve via MSKU — 3-tier FNSKU cascade
      const msku = await prisma.productGradeMarketplaceSku.findUnique({
        where: { id: item.mskuId },
        include: { product: true },
      })
      if (!msku) return NextResponse.json({ error: `MSKU ${item.mskuId} not found` }, { status: 404 })

      let fnsku = msku.fnsku
      let asin: string | null = null

      if (!fnsku) {
        const listing = await prisma.sellerListing.findFirst({
          where: { accountId, sku: msku.sellerSku, fnsku: { not: null } },
        })
        if (listing?.fnsku) {
          fnsku = listing.fnsku
          asin = listing.asin ?? null
        }
      }

      if (!fnsku) {
        try {
          const result = await fetchFnsku(accountId, account.marketplaceId, msku.sellerSku)
          fnsku = result.fnsku
          asin = result.asin
          await prisma.productGradeMarketplaceSku.update({
            where: { id: item.mskuId },
            data: { fnsku },
          })
        } catch (err) {
          return NextResponse.json(
            { error: `Could not resolve FNSKU for SKU "${msku.sellerSku}": ${err instanceof Error ? err.message : String(err)}` },
            { status: 400 },
          )
        }
      }

      itemsData.push({ mskuId: msku.id, sellerSku: msku.sellerSku, fnsku: fnsku!, asin, quantity: item.quantity })
    } else if (item.sellerSku && item.fnsku) {
      // Direct — listing found via search but no MSKU mapping
      itemsData.push({
        mskuId: null,
        sellerSku: item.sellerSku,
        fnsku: item.fnsku,
        asin: item.asin ?? null,
        quantity: item.quantity,
      })
    } else if (item.sellerSku) {
      // Has sellerSku but no fnsku — try to resolve
      let fnsku: string | null = null
      let asin: string | null = null

      const listing = await prisma.sellerListing.findFirst({
        where: { accountId, sku: item.sellerSku, fnsku: { not: null } },
      })
      if (listing?.fnsku) {
        fnsku = listing.fnsku
        asin = listing.asin ?? null
      }

      if (!fnsku) {
        try {
          const result = await fetchFnsku(accountId, account.marketplaceId, item.sellerSku)
          fnsku = result.fnsku
          asin = result.asin
        } catch (err) {
          return NextResponse.json(
            { error: `Could not resolve FNSKU for SKU "${item.sellerSku}": ${err instanceof Error ? err.message : String(err)}` },
            { status: 400 },
          )
        }
      }

      itemsData.push({ mskuId: null, sellerSku: item.sellerSku, fnsku: fnsku!, asin, quantity: item.quantity })
    } else {
      return NextResponse.json({ error: 'Each item must have mskuId or sellerSku' }, { status: 400 })
    }
  }

  // Generate sequential shipment number (FBA-0001)
  const lastShipment = await prisma.fbaShipment.findFirst({
    where: { shipmentNumber: { not: null } },
    orderBy: { shipmentNumber: 'desc' },
    select: { shipmentNumber: true },
  })
  let nextNum = 1
  if (lastShipment?.shipmentNumber) {
    const match = lastShipment.shipmentNumber.match(/FBA-(\d+)/)
    if (match) nextNum = parseInt(match[1]) + 1
  }
  const shipmentNumber = `FBA-${String(nextNum).padStart(4, '0')}`

  // Create shipment with items only (no warehouse, no inventory reservation)
  const shipment = await prisma.fbaShipment.create({
    data: {
      accountId,
      shipmentNumber,
      name: name || null,
      status: 'DRAFT',
      items: {
        create: itemsData.map(item => ({
          mskuId: item.mskuId,
          sellerSku: item.sellerSku,
          fnsku: item.fnsku,
          asin: item.asin,
          quantity: item.quantity,
        })),
      },
    },
    include: {
      items: {
        include: {
          msku: {
            select: {
              sellerSku: true,
              product: { select: { id: true, sku: true, description: true } },
              grade: { select: { id: true, grade: true } },
            },
          },
        },
      },
    },
  })

  return NextResponse.json(shipment, { status: 201 })
}
