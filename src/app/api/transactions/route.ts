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

  // Search across orderId, description, transactionType
  const search = searchParams.get('search')?.trim()
  if (search) {
    where.OR = [
      { orderId: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { transactionType: { contains: search, mode: 'insensitive' } },
    ]
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

  const totalCredits = Number(creditAgg._sum.totalAmount ?? 0)
  const totalDebits = Number(debitAgg._sum.totalAmount ?? 0)

  return NextResponse.json({
    data: transactions,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    summary: {
      totalCredits,
      totalDebits,
      netAmount: totalCredits + totalDebits, // debits are negative
    },
  })
}
