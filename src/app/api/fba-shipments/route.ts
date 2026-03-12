/**
 * GET  /api/fba-shipments         — list all FBA shipments
 * POST /api/fba-shipments         — create a new draft shipment (reserves inventory)
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
  const where = status ? { status: status as never } : {}

  const shipments = await prisma.fbaShipment.findMany({
    where,
    include: {
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
  mskuId: string
  quantity: number
  productId: string
  locationId: string
  gradeId?: string | null
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { accountId: string; warehouseId: string; name?: string; items: CreateItem[] }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { accountId, warehouseId, name, items } = body
  if (!accountId || !warehouseId || !items?.length) {
    return NextResponse.json({ error: 'accountId, warehouseId, and items are required' }, { status: 400 })
  }

  // Validate warehouse has address
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } })
  if (!warehouse) return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
  if (!warehouse.addressLine1 || !warehouse.city || !warehouse.state || !warehouse.postalCode) {
    return NextResponse.json({ error: 'Warehouse must have a complete shipping address' }, { status: 400 })
  }

  // Get account for marketplace info
  const account = await prisma.amazonAccount.findUnique({ where: { id: accountId } })
  if (!account) return NextResponse.json({ error: 'Amazon account not found' }, { status: 404 })

  // Resolve FNSKU for each item (3-tier cascade: MSKU → SellerListing → API)
  const resolvedItems: Array<CreateItem & { sellerSku: string; fnsku: string; asin: string | null }> = []

  for (const item of items) {
    const msku = await prisma.productGradeMarketplaceSku.findUnique({
      where: { id: item.mskuId },
      include: { product: true },
    })
    if (!msku) return NextResponse.json({ error: `MSKU ${item.mskuId} not found` }, { status: 404 })

    let fnsku = msku.fnsku
    let asin: string | null = null

    // Tier 1: MSKU has fnsku cached
    if (!fnsku) {
      // Tier 2: check SellerListing
      const listing = await prisma.sellerListing.findFirst({
        where: { accountId, sku: msku.sellerSku, fnsku: { not: null } },
      })
      if (listing?.fnsku) {
        fnsku = listing.fnsku
        asin = listing.asin ?? null
      }
    }

    if (!fnsku) {
      // Tier 3: live API call
      try {
        const result = await fetchFnsku(accountId, account.marketplaceId, msku.sellerSku)
        fnsku = result.fnsku
        asin = result.asin
        // Cache back to MSKU
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

    resolvedItems.push({ ...item, sellerSku: msku.sellerSku, fnsku: fnsku!, asin })
  }

  // Validate inventory availability
  for (const item of resolvedItems) {
    const gradeId = item.gradeId ?? null
    const inv = gradeId
      ? await prisma.inventoryItem.findUnique({
          where: { productId_locationId_gradeId: { productId: item.productId, locationId: item.locationId, gradeId } },
        })
      : await prisma.inventoryItem.findFirst({
          where: { productId: item.productId, locationId: item.locationId, gradeId: null },
        })
    if (!inv || inv.qty < item.quantity) {
      return NextResponse.json(
        { error: `Insufficient stock for SKU "${item.sellerSku}" (available: ${inv?.qty ?? 0}, requested: ${item.quantity})` },
        { status: 409 },
      )
    }
  }

  // Create shipment + reserve inventory in a transaction
  const shipment = await prisma.$transaction(async tx => {
    const created = await tx.fbaShipment.create({
      data: {
        accountId,
        warehouseId,
        name: name || null,
        status: 'DRAFT',
        items: {
          create: resolvedItems.map(item => ({
            mskuId: item.mskuId,
            sellerSku: item.sellerSku,
            fnsku: item.fnsku,
            asin: item.asin,
            quantity: item.quantity,
          })),
        },
      },
      include: { items: true },
    })

    // Deduct inventory and create reservations
    for (const item of resolvedItems) {
      const gradeId = item.gradeId ?? null

      if (gradeId) {
        await tx.inventoryItem.update({
          where: { productId_locationId_gradeId: { productId: item.productId, locationId: item.locationId, gradeId } },
          data: { qty: { decrement: item.quantity } },
        })
      } else {
        const inv = await tx.inventoryItem.findFirst({
          where: { productId: item.productId, locationId: item.locationId, gradeId: null },
        })
        if (!inv) throw new Error(`Inventory not found for product ${item.productId}`)
        await tx.inventoryItem.update({
          where: { id: inv.id },
          data: { qty: { decrement: item.quantity } },
        })
      }

      await tx.fbaInventoryReservation.create({
        data: {
          fbaShipmentId: created.id,
          productId: item.productId,
          locationId: item.locationId,
          gradeId,
          qtyReserved: item.quantity,
        },
      })
    }

    return created
  })

  return NextResponse.json(shipment, { status: 201 })
}
