/**
 * POST /api/sickw/check — run an IMEI check via SICKW API
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { runSickwCheck } from '@/lib/sickw/check'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { imei, serviceId, serviceName } = await req.json() as {
    imei?: string
    serviceId?: number
    serviceName?: string
  }

  if (!imei || !/^[A-Za-z0-9]{8,15}$/.test(imei)) {
    return NextResponse.json({ error: 'IMEI/Serial must be 8-15 alphanumeric characters' }, { status: 400 })
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
    // Runs the check and self-corrects an Apple FMI device-class misroute
    // (e.g. iMac sent to iCloud ON/OFF → retried on the Mac service).
    const { data, serviceId: usedServiceId, serviceName: usedServiceName, status, autoCorrected } =
      await runSickwCheck(apiKey, imei, serviceId, serviceName)

    const cost = (data as { cost?: number | string | null }).cost
    const check = await prisma.sickwCheck.create({
      data: {
        imei,
        serviceId: usedServiceId,
        serviceName: usedServiceName,
        status,
        result: JSON.stringify(data),
        cost: cost != null ? cost : null,
      },
    })

    return NextResponse.json({ id: check.id, status, data, serviceUsed: usedServiceId, autoCorrected })
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
