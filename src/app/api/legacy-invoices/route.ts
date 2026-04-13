import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const maxDuration = 120

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const invoices = await prisma.legacyInvoice.findMany({
    orderBy: { orderDate: 'desc' },
  })

  return NextResponse.json({ data: invoices })
}

interface InvoiceRecord {
  orderId: string
  orderDate?: string
  customerName?: string
  address?: string
  items?: unknown[]
  tracking?: string[]
  rawText?: string
  _file?: string
  fileName?: string
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { records } = await req.json()
  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: 'records[] is required' }, { status: 400 })
  }

  try {
    const byFile = new Map<string, InvoiceRecord[]>()
    for (const r of records as InvoiceRecord[]) {
      const fn = r._file ?? r.fileName ?? ''
      if (!byFile.has(fn)) byFile.set(fn, [])
      byFile.get(fn)!.push(r)
    }

    let upserted = 0

    for (const [fileName, recs] of Array.from(byFile.entries())) {
      await prisma.legacyInvoice.deleteMany({ where: { fileName } })

      for (let i = 0; i < recs.length; i += 500) {
        const chunk = recs.slice(i, i + 500)
        await prisma.legacyInvoice.createMany({
          data: chunk.map(r => ({
            orderId: r.orderId,
            orderDate: r.orderDate ?? '',
            customerName: r.customerName ?? '',
            address: r.address ?? '',
            items: (r.items ?? []) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            tracking: (r.tracking ?? []) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            rawText: r.rawText ?? '',
            fileName,
          })),
          skipDuplicates: true,
        })
        upserted += chunk.length
      }
    }

    return NextResponse.json({ upserted })
  } catch (err) {
    console.error('legacy-invoices POST error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
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
