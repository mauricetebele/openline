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

  const ops = records.map((r: Record<string, unknown>) =>
    prisma.legacyPOSerial.upsert({
      where: {
        serial_fileName: { serial: r.serial as string, fileName: (r._file ?? r.fileName ?? '') as string },
      },
      create: {
        productSku: (r.productSku ?? '') as string,
        serial: r.serial as string,
        vendor: (r.vendor ?? '') as string,
        receivedDate: (r.receivedDate ?? '') as string,
        cost: (r.cost as number | null) ?? null,
        poCode: (r.poCode ?? '') as string,
        fileName: ((r._file ?? r.fileName ?? '') as string),
      },
      update: {
        productSku: (r.productSku ?? '') as string,
        vendor: (r.vendor ?? '') as string,
        receivedDate: (r.receivedDate ?? '') as string,
        cost: (r.cost as number | null) ?? null,
        poCode: (r.poCode ?? '') as string,
      },
    })
  )

  // Batch in chunks of 200 to avoid exceeding query limits
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
