import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
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

  const ops = records.map((r: Record<string, unknown>) =>
    prisma.legacyInvoice.upsert({
      where: {
        orderId_fileName: { orderId: r.orderId as string, fileName: ((r._file ?? r.fileName ?? '') as string) },
      },
      create: {
        orderId: r.orderId as string,
        orderDate: (r.orderDate ?? '') as string,
        customerName: (r.customerName ?? '') as string,
        address: (r.address ?? '') as string,
        items: (r.items ?? []) as unknown as Prisma.InputJsonValue,
        tracking: (r.tracking ?? []) as string[],
        rawText: (r.rawText ?? '') as string,
        fileName: ((r._file ?? r.fileName ?? '') as string),
      },
      update: {
        orderDate: (r.orderDate ?? '') as string,
        customerName: (r.customerName ?? '') as string,
        address: (r.address ?? '') as string,
        items: (r.items ?? []) as unknown as Prisma.InputJsonValue,
        tracking: (r.tracking ?? []) as string[],
        rawText: (r.rawText ?? '') as string,
      },
    })
  )

  let upserted = 0
  for (let i = 0; i < ops.length; i += 200) {
    const batch = ops.slice(i, i + 200)
    await prisma.$transaction(batch)
    upserted += batch.length
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
