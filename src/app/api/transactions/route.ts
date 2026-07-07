/**
 * GET /api/transactions — Paginated list of Amazon financial transactions
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
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? '50')))
  const skip = (page - 1) * pageSize

  const where: Prisma.AmazonTransactionWhereInput = {}

  // Search across orderId, description, transactionType, and amount
  const search = searchParams.get('search')?.trim()
  if (search) {
    const orClauses: Prisma.AmazonTransactionWhereInput[] = [
      { orderId: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { transactionType: { contains: search, mode: 'insensitive' } },
    ]
    // If search looks like a number/dollar amount, also match totalAmount
    const cleaned = search.replace(/[$,+\-\s]/g, '')
    const num = parseFloat(cleaned)
    if (!isNaN(num) && cleaned.length > 0) {
      orClauses.push({ totalAmount: num })
      orClauses.push({ totalAmount: -num })
    }
    where.OR = orClauses
  }

  // Exact filters
  const type = searchParams.get('type')
  if (type) where.transactionType = type

  const creditOrDebit = searchParams.get('creditOrDebit')
  if (creditOrDebit) where.creditOrDebit = creditOrDebit

  const status = searchParams.get('status')
  if (status) where.transactionStatus = status

  // Date range
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  if (startDate || endDate) {
    where.postedDate = {}
    if (startDate) where.postedDate.gte = new Date(startDate)
    if (endDate) where.postedDate.lte = new Date(endDate + 'T23:59:59.999Z')
  }

  // Sorting
  const sortBy = searchParams.get('sortBy') ?? 'postedDate'
  const sortDir = (searchParams.get('sortDir') ?? 'desc') as 'asc' | 'desc'

  const sortMap: Record<string, Prisma.AmazonTransactionOrderByWithRelationInput> = {
    postedDate: { postedDate: sortDir },
    totalAmount: { totalAmount: sortDir },
  }
  const orderBy = sortMap[sortBy] ?? { postedDate: sortDir }

  // Fulfillment channel filter (FBA/MFN) — requires subquery on orders table
  const fulfillment = searchParams.get('fulfillment') // "FBA" | "MFN"
  if (fulfillment) {
    // Find order IDs that match the fulfillment channel
    const matchingOrders = await prisma.order.findMany({
      where: { fulfillmentChannel: fulfillment },
      select: { amazonOrderId: true },
      distinct: ['amazonOrderId'],
    })
    const orderIds = matchingOrders.map(o => o.amazonOrderId)
    where.orderId = { in: orderIds }
  }

  // Fetch data + count + summary in parallel
  const [total, transactions, creditAgg, debitAgg] = await Promise.all([
    prisma.amazonTransaction.count({ where }),
    prisma.amazonTransaction.findMany({
      where,
      skip,
      take: pageSize,
      orderBy,
    }),
    prisma.amazonTransaction.aggregate({
      where: { ...where, creditOrDebit: 'CREDIT' },
      _sum: { totalAmount: true },
    }),
    prisma.amazonTransaction.aggregate({
      where: { ...where, creditOrDebit: 'DEBIT' },
      _sum: { totalAmount: true },
    }),
  ])

  // Enrich transactions with fulfillment channel from orders table
  const orderIds = Array.from(new Set(transactions.map(t => t.orderId).filter(Boolean))) as string[]
  const fulfillmentMap = new Map<string, string>()
  if (orderIds.length > 0) {
    const orders = await prisma.order.findMany({
      where: { amazonOrderId: { in: orderIds } },
      select: { amazonOrderId: true, fulfillmentChannel: true },
      distinct: ['amazonOrderId'],
    })
    for (const o of orders) {
      if (o.fulfillmentChannel) fulfillmentMap.set(o.amazonOrderId, o.fulfillmentChannel)
    }
  }

  const enrichedData = transactions.map(t => ({
    ...t,
    fulfillmentChannel: t.orderId ? (fulfillmentMap.get(t.orderId) ?? null) : null,
  }))

  const totalCredits = Number(creditAgg._sum.totalAmount ?? 0)
  const totalDebits = Number(debitAgg._sum.totalAmount ?? 0)

  return NextResponse.json({
    data: enrichedData,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    summary: {
      totalCredits,
      totalDebits,
      netAmount: totalCredits + totalDebits, // debits are negative
    },
  })
}
