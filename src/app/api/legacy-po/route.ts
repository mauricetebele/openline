import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serials = await prisma.legacyPOSerial.findMany({
    orderBy: { receivedDate: 'desc' },
  })

  return NextResponse.json({ data: serials })
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
    await prisma.legacyPOSerial.upsert({
      where: {
        serial_fileName: { serial: r.serial, fileName: r._file ?? r.fileName ?? '' },
      },
      create: {
        productSku: r.productSku ?? '',
        serial: r.serial,
        vendor: r.vendor ?? '',
        receivedDate: r.receivedDate ?? '',
        cost: r.cost ?? null,
        poCode: r.poCode ?? '',
        fileName: r._file ?? r.fileName ?? '',
      },
      update: {
        productSku: r.productSku ?? '',
        vendor: r.vendor ?? '',
        receivedDate: r.receivedDate ?? '',
        cost: r.cost ?? null,
        poCode: r.poCode ?? '',
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
