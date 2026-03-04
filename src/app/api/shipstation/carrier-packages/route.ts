/**
 * GET /api/shipstation/carrier-packages?carrierCode=xxx
 * Returns the list of package types available for a given V1 carrier code.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const carrierCode = req.nextUrl.searchParams.get('carrierCode')?.trim()
  if (!carrierCode) return NextResponse.json({ error: 'Missing carrierCode' }, { status: 400 })

  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
  })
  if (!account) return NextResponse.json({ error: 'No ShipStation account connected' }, { status: 404 })

  const v2ApiKey = account.v2ApiKeyEnc ? decrypt(account.v2ApiKeyEnc) : null
  const client = new ShipStationClient(decrypt(account.apiKeyEnc), account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '', v2ApiKey)

  try {
    const packages = await client.getCarrierPackages(carrierCode)
    return NextResponse.json(packages)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
