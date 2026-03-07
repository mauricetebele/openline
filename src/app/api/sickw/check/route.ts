/**
 * POST /api/sickw/check — run an IMEI check via SICKW API
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { imei, serviceId, serviceName } = await req.json() as {
    imei?: string
    serviceId?: number
    serviceName?: string
  }

  if (!imei || !/^[A-Za-z0-9]{11,15}$/.test(imei)) {
    return NextResponse.json({ error: 'IMEI must be 11-15 alphanumeric characters' }, { status: 400 })
  }
  if (!serviceId || !serviceName) {
    return NextResponse.json({ error: 'serviceId and serviceName are required' }, { status: 400 })
  }

  const cred = await prisma.sickwCredential.findFirst({ where: { isActive: true } })
  if (!cred) {
    return NextResponse.json({ error: 'SICKW API key not configured. Go to Settings > SICKW to add it.' }, { status: 400 })
  }

  let apiKey: string
  try {
    apiKey = decrypt(cred.apiKeyEnc)
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt API key' }, { status: 500 })
  }

  try {
    const url = `https://sickw.com/api.php?format=json&key=${encodeURIComponent(apiKey)}&imei=${encodeURIComponent(imei)}&service=${serviceId}`
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json()

    const status = data.status === 'success' || data.status === 'Success' ? 'success' : 'error'

    const check = await prisma.sickwCheck.create({
      data: {
        imei,
        serviceId,
        serviceName,
        status,
        result: JSON.stringify(data),
        cost: data.cost != null ? data.cost : null,
      },
    })

    return NextResponse.json({ id: check.id, status, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    await prisma.sickwCheck.create({
      data: {
        imei,
        serviceId,
        serviceName,
        status: 'error',
        result: JSON.stringify({ error: message }),
      },
    })

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
