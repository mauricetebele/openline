import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import crypto from 'crypto'

export const maxDuration = 120

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serials = await prisma.legacyPOSerial.findMany({
    orderBy: { receivedDate: 'desc' },
  })

  return NextResponse.json({ data: serials })
}

interface PORecord {
  productSku?: string
  serial: string
  vendor?: string
  receivedDate?: string
  cost?: number | null
  poCode?: string
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
    const CHUNK = 250
    let upserted = 0

    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK) as PORecord[]

      const values = chunk.map((r) => {
        const id = crypto.randomUUID()
        const productSku = r.productSku ?? ''
        const serial = r.serial
        const vendor = r.vendor ?? ''
        const receivedDate = r.receivedDate ?? ''
        const cost = r.cost ?? null
        const poCode = r.poCode ?? ''
        const fileName = r._file ?? r.fileName ?? ''
        return `('${id}', '${esc(productSku)}', '${esc(serial)}', '${esc(vendor)}', '${esc(receivedDate)}', ${cost === null ? 'NULL' : cost}, '${esc(poCode)}', '${esc(fileName)}', NOW())`
      })

      await prisma.$executeRawUnsafe(`
        INSERT INTO legacy_po_serials ("id", "productSku", "serial", "vendor", "receivedDate", "cost", "poCode", "fileName", "createdAt")
        VALUES ${values.join(',\n')}
        ON CONFLICT ("serial", "fileName") DO UPDATE SET
          "productSku" = EXCLUDED."productSku",
          "vendor" = EXCLUDED."vendor",
          "receivedDate" = EXCLUDED."receivedDate",
          "cost" = EXCLUDED."cost",
          "poCode" = EXCLUDED."poCode"
      `)
      upserted += chunk.length
    }

    return NextResponse.json({ upserted })
  } catch (err) {
    console.error('legacy-po POST error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

function esc(s: string): string {
  return s.replace(/'/g, "''")
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (body.all) {
    const result = await prisma.legacyPOSerial.deleteMany()
    return NextResponse.json({ deleted: result.count })
  }

  if (body.fileName) {
    const result = await prisma.legacyPOSerial.deleteMany({
      where: { fileName: body.fileName },
    })
    return NextResponse.json({ deleted: result.count })
  }

  return NextResponse.json({ error: 'Provide { fileName } or { all: true }' }, { status: 400 })
}
