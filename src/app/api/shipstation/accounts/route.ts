import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { encrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.shipStationAccount.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, name: true, isActive: true, createdAt: true,
      partition: true, internalJwtExp: true, defaultShipFromId: true,
      internalSellerId: true, internalUserId: true,
      amazonCarrierId: true, v2ApiKeyEnc: true,
    },
  })
  return NextResponse.json(accounts.map(({ v2ApiKeyEnc, ...a }) => ({
    ...a,
    hasV2Key: !!v2ApiKeyEnc,
  })))
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, apiKey, apiSecret } = await req.json()
  if (!apiKey?.trim()) {
    return NextResponse.json({ error: 'API Key is required' }, { status: 400 })
  }

  const key = apiKey.trim()
  const secret = apiSecret?.trim() || null

  // Test connection before saving — use V2 if no secret provided
  try {
    const client = new ShipStationClient(key, secret ?? '', secret ? null : key)
    if (secret) {
      await client.testConnection()        // V1 Basic auth test
    } else {
      await client.getV2Carriers()         // V2 API-Key test
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid credentials — ${err instanceof Error ? err.message : 'connection failed'}` },
      { status: 400 },
    )
  }

  const account = await prisma.shipStationAccount.create({
    data: {
      name: name?.trim() || 'ShipStation',
      apiKeyEnc: encrypt(key),
      apiSecretEnc: secret ? encrypt(secret) : null,
      v2ApiKeyEnc: secret ? null : encrypt(key),  // store as V2 key if no secret
    },
    select: { id: true, name: true, isActive: true, createdAt: true },
  })
  return NextResponse.json(account, { status: 201 })
}
