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
  if (!apiKey?.trim() || !apiSecret?.trim()) {
    return NextResponse.json({ error: 'API Key and API Secret are required' }, { status: 400 })
  }

  // Test connection before saving
  try {
    await new ShipStationClient(apiKey.trim(), apiSecret.trim()).testConnection()
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid credentials — ${err instanceof Error ? err.message : 'connection failed'}` },
      { status: 400 },
    )
  }

  const account = await prisma.shipStationAccount.create({
    data: {
      name: name?.trim() || 'ShipStation',
      apiKeyEnc: encrypt(apiKey.trim()),
      apiSecretEnc: encrypt(apiSecret.trim()),
    },
    select: { id: true, name: true, isActive: true, createdAt: true },
  })
  return NextResponse.json(account, { status: 201 })
}
