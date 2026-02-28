/**
 * GET /api/customers
 * Returns a unified list of customers from all sources:
 *   - Amazon orders (deduplicated by shipToName + shipToPostal)
 *   - Wholesale customers
 *
 * Query params:
 *   search  — filter by name / company / city / state / zip
 *   type    — "amazon" | "wholesale" | "" (all)
 *   page    — 1-based
 *   limit   — default 100
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search')?.trim().toLowerCase() ?? ''
  const typeFilter = searchParams.get('type')?.trim() ?? ''
  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(200, parseInt(searchParams.get('limit') ?? '100', 10))

  type UnifiedCustomer = {
    id: string
    type: string          // marketplace name or "Wholesale"
    firstName: string | null
    lastName:  string | null
    companyName: string | null
    city:    string | null
    state:   string | null
    zip:     string | null
    phone:   string | null
    email:   string | null
    ordersCount: number
    sourceId: string      // original record id
    createdAt: string | null
    lookupKey: string     // used to fetch order history: "ws:{id}" or "amz:{lower(name)}|{lower(postal)}"
  }

  const results: UnifiedCustomer[] = []

  // ── Wholesale customers ───────────────────────────────────────────────────
  if (!typeFilter || typeFilter === 'wholesale') {
    const ws = await prisma.wholesaleCustomer.findMany({
      select: {
        id: true,
        companyName: true,
        contactName: true,
        phone: true,
        email: true,
        createdAt: true,
        addresses: {
          where: { isDefault: true },
          take: 1,
          select: { city: true, state: true, postalCode: true },
        },
        _count: { select: { salesOrders: true } },
      },
      orderBy: { companyName: 'asc' },
    })

    for (const c of ws) {
      const parts = (c.contactName ?? '').trim().split(/\s+/)
      const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || null
      const lastName  = parts.length > 1 ? parts[parts.length - 1] : null
      const addr = c.addresses[0]

      const row: UnifiedCustomer = {
        id:          `ws-${c.id}`,
        type:        'Wholesale',
        firstName,
        lastName,
        companyName: c.companyName,
        city:        addr?.city   ?? null,
        state:       addr?.state  ?? null,
        zip:         addr?.postalCode ?? null,
        phone:       c.phone ?? null,
        email:       c.email ?? null,
        ordersCount: c._count.salesOrders,
        sourceId:    c.id,
        createdAt:   c.createdAt.toISOString(),
        lookupKey:   `ws:${c.id}`,
      }

      if (search) {
        const hay = [row.companyName, row.firstName, row.lastName, row.city, row.state, row.zip, row.email]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(search)) continue
      }

      results.push(row)
    }
  }

  // ── Amazon order customers (deduplicated by name+postal) ─────────────────
  if (!typeFilter || typeFilter === 'amazon') {
    // Group orders by (shipToName, shipToPostal) to deduplicate; get the account marketplace
    const orders = await prisma.order.findMany({
      where: {
        shipToName: { not: null },
        NOT: { shipToName: '' },
      },
      select: {
        id: true,
        shipToName:    true,
        shipToCity:    true,
        shipToState:   true,
        shipToPostal:  true,
        shipToPhone:   true,
        purchaseDate:  true,
        account: { select: { id: true, marketplaceName: true } },
      },
      orderBy: { purchaseDate: 'desc' },
    })

    // Deduplicate: key = lower(name)|lower(postal)
    const seen     = new Map<string, UnifiedCustomer>()
    const earliest = new Map<string, Date>()
    for (const o of orders) {
      const key = `${(o.shipToName ?? '').toLowerCase()}|${(o.shipToPostal ?? '').toLowerCase()}`
      if (seen.has(key)) {
        seen.get(key)!.ordersCount++
        if (o.purchaseDate) {
          const prev = earliest.get(key)
          if (!prev || o.purchaseDate < prev) earliest.set(key, o.purchaseDate)
        }
        continue
      }

      const nameParts = (o.shipToName ?? '').trim().split(/\s+/)
      const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : nameParts[0] || null
      const lastName  = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null

      const row: UnifiedCustomer = {
        id:          `amz-${o.id}`,
        type:        o.account.marketplaceName,
        firstName,
        lastName,
        companyName: null,
        city:        o.shipToCity   ?? null,
        state:       o.shipToState  ?? null,
        zip:         o.shipToPostal ?? null,
        phone:       o.shipToPhone  ?? null,
        email:       null,
        ordersCount: 1,
        sourceId:    o.id,
        createdAt:   o.purchaseDate ? o.purchaseDate.toISOString() : null,
        lookupKey:   key,
      }
      if (o.purchaseDate) earliest.set(key, o.purchaseDate)

      if (search) {
        const hay = [row.firstName, row.lastName, row.city, row.state, row.zip]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(search)) continue
      }

      seen.set(key, row)
    }

    // Resolve createdAt for Amazon customers to earliest purchaseDate
    for (const [key, row] of seen.entries()) {
      const e = earliest.get(key)
      if (e) row.createdAt = e.toISOString()
    }

    results.push(...seen.values())
  }

  // Sort: wholesale first, then by last name / company
  results.sort((a, b) => {
    if (a.type === 'Wholesale' && b.type !== 'Wholesale') return -1
    if (b.type === 'Wholesale' && a.type !== 'Wholesale') return 1
    const aName = a.companyName ?? `${a.lastName} ${a.firstName}` ?? ''
    const bName = b.companyName ?? `${b.lastName} ${b.firstName}` ?? ''
    return aName.localeCompare(bName)
  })

  const total = results.length
  const paginated = results.slice((page - 1) * limit, page * limit)

  return NextResponse.json({ data: paginated, total, page, limit })
}
