import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const invoices = await prisma.legacyInvoice.findMany({
    orderBy: { orderDate: 'desc' },
  })

  return NextResponse.json({ data: invoices })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { records } = await req.json()
  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: 'records[] is required' }, { status: 400 })
  }

  let upserted = 0
  for (const r of records) {
    await prisma.legacyInvoice.upsert({
      where: {
        orderId_fileName: { orderId: r.orderId, fileName: r._file ?? r.fileName ?? '' },
      },
      create: {
        orderId: r.orderId,
        orderDate: r.orderDate ?? '',
        customerName: r.customerName ?? '',
        address: r.address ?? '',
        items: r.items ?? [],
        tracking: r.tracking ?? [],
        rawText: r.rawText ?? '',
        fileName: r._file ?? r.fileName ?? '',
      },
      update: {
        orderDate: r.orderDate ?? '',
        customerName: r.customerName ?? '',
        address: r.address ?? '',
        items: r.items ?? [],
        tracking: r.tracking ?? [],
        rawText: r.rawText ?? '',
      },
    })
    upserted++
  }

  return NextResponse.json({ upserted })
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (body.all) {
    const result = await prisma.legacyInvoice.deleteMany()
    return NextResponse.json({ deleted: result.count })
  }

  if (body.fileName) {
    const result = await prisma.legacyInvoice.deleteMany({
      where: { fileName: body.fileName },
    })
    return NextResponse.json({ deleted: result.count })
  }

  return NextResponse.json({ error: 'Provide { fileName } or { all: true }' }, { status: 400 })
}
