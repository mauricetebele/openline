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

  const { records, clearFile } = await req.json()
  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: 'records[] is required' }, { status: 400 })
  }

  try {
    // If clearFile is set, delete existing records for that file first
    // (only sent with the first chunk of a file)
    if (clearFile) {
      await prisma.legacyPOSerial.deleteMany({ where: { fileName: clearFile } })
    }

    await prisma.legacyPOSerial.createMany({
      data: (records as PORecord[]).map(r => ({
        productSku: r.productSku ?? '',
        serial: r.serial,
        vendor: r.vendor ?? '',
        receivedDate: r.receivedDate ?? '',
        cost: r.cost ?? null,
        poCode: r.poCode ?? '',
        fileName: r._file ?? r.fileName ?? '',
      })),
      skipDuplicates: true,
    })

    return NextResponse.json({ upserted: records.length })
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
