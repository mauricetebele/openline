import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const vendorId = req.nextUrl.searchParams.get('vendorId')

  const entries = await prisma.vendorLedgerEntry.findMany({
    where: vendorId ? { vendorId } : {},
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      adjustments: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ data: entries })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { vendorId, type, amount, description, fileBase64, fileFilename } = body as {
    vendorId: string
    type: 'DEBIT' | 'CREDIT'
    amount: number
    description?: string
    fileBase64?: string
    fileFilename?: string
  }

  if (!vendorId) return NextResponse.json({ error: 'Vendor is required' }, { status: 400 })
  if (!type || !['DEBIT', 'CREDIT'].includes(type)) {
    return NextResponse.json({ error: 'Type must be DEBIT or CREDIT' }, { status: 400 })
  }
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 })
  }

  const entry = await prisma.vendorLedgerEntry.create({
    data: {
      vendorId,
      type,
      amount,
      description: description?.trim() || null,
      ...(fileBase64 ? { fileBase64 } : {}),
      ...(fileFilename ? { fileFilename } : {}),
    },
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      adjustments: true,
    },
  })

  return NextResponse.json(entry, { status: 201 })
}
