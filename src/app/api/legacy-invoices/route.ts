import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import crypto from 'crypto'

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

  const CHUNK = 500
  let upserted = 0

  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK) as InvoiceRecord[]

    const values = chunk.map((r) => {
      const id = crypto.randomUUID()
      const orderId = r.orderId
      const orderDate = r.orderDate ?? ''
      const customerName = r.customerName ?? ''
      const address = r.address ?? ''
      const items = JSON.stringify(r.items ?? [])
      const tracking = JSON.stringify(r.tracking ?? [])
      const rawText = r.rawText ?? ''
      const fileName = r._file ?? r.fileName ?? ''
      return `('${id}', '${esc(orderId)}', '${esc(orderDate)}', '${esc(customerName)}', '${esc(address)}', '${esc(items)}'::jsonb, '${esc(tracking)}'::jsonb, '${esc(rawText)}', '${esc(fileName)}', NOW())`
    })

    await prisma.$executeRawUnsafe(`
      INSERT INTO legacy_invoices ("id", "orderId", "orderDate", "customerName", "address", "items", "tracking", "rawText", "fileName", "createdAt")
      VALUES ${values.join(',\n')}
      ON CONFLICT ("orderId", "fileName") DO UPDATE SET
        "orderDate" = EXCLUDED."orderDate",
        "customerName" = EXCLUDED."customerName",
        "address" = EXCLUDED."address",
        "items" = EXCLUDED."items",
        "tracking" = EXCLUDED."tracking",
        "rawText" = EXCLUDED."rawText"
    `)
    upserted += chunk.length
  }

  return NextResponse.json({ upserted })
}

function esc(s: string): string {
  return s.replace(/'/g, "''")
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
