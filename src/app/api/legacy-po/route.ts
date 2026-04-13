import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

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
    // Group by fileName so we can delete-then-insert per file
    const byFile = new Map<string, PORecord[]>()
    for (const r of records as PORecord[]) {
      const fn = r._file ?? r.fileName ?? ''
      if (!byFile.has(fn)) byFile.set(fn, [])
      byFile.get(fn)!.push(r)
    }

    let upserted = 0

    for (const [fileName, recs] of Array.from(byFile.entries())) {
      // Delete existing records for this file, then bulk insert
      await prisma.legacyPOSerial.deleteMany({ where: { fileName } })

      // createMany in chunks of 1000
      for (let i = 0; i < recs.length; i += 1000) {
        const chunk = recs.slice(i, i + 1000)
        await prisma.legacyPOSerial.createMany({
          data: chunk.map(r => ({
            productSku: r.productSku ?? '',
            serial: r.serial,
            vendor: r.vendor ?? '',
            receivedDate: r.receivedDate ?? '',
            cost: r.cost ?? null,
            poCode: r.poCode ?? '',
            fileName,
          })),
          skipDuplicates: true,
        })
        upserted += chunk.length
      }
    }

    return NextResponse.json({ upserted })
  } catch (err) {
    console.error('legacy-po POST error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
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
