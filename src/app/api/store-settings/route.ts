import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

const SINGLETON_ID = 'singleton'
const MAX_LOGO_BYTES = 500_000 // ~500 KB base64

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = await prisma.storeSettings.findUnique({ where: { id: SINGLETON_ID } })

  // Return defaults if no row yet
  if (!settings) {
    return NextResponse.json({
      storeName: 'Open Line Mobility',
      logoBase64: null,
      phone: null,
      email: null,
      addressLine: null,
      city: null,
      state: null,
      zip: null,
      thankYouMsg: 'Thank you for shopping with us!',
      primaryColor: '#14284B',
      accentColor: '#007ACC',
    })
  }

  return NextResponse.json(settings)
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { storeName, logoBase64, phone, email, addressLine, city, state, zip, thankYouMsg, primaryColor, accentColor } = body

  // Validate logo size
  if (logoBase64 && typeof logoBase64 === 'string' && logoBase64.length > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: 'Logo is too large. Max 500 KB.' }, { status: 400 })
  }

  const settings = await prisma.storeSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      storeName: storeName ?? 'Open Line Mobility',
      logoBase64: logoBase64 ?? null,
      phone: phone ?? null,
      email: email ?? null,
      addressLine: addressLine ?? null,
      city: city ?? null,
      state: state ?? null,
      zip: zip ?? null,
      thankYouMsg: thankYouMsg ?? 'Thank you for shopping with us!',
      primaryColor: primaryColor ?? '#14284B',
      accentColor: accentColor ?? '#007ACC',
    },
    update: {
      ...(storeName !== undefined && { storeName }),
      ...(logoBase64 !== undefined && { logoBase64 }),
      ...(phone !== undefined && { phone }),
      ...(email !== undefined && { email }),
      ...(addressLine !== undefined && { addressLine }),
      ...(city !== undefined && { city }),
      ...(state !== undefined && { state }),
      ...(zip !== undefined && { zip }),
      ...(thankYouMsg !== undefined && { thankYouMsg }),
      ...(primaryColor !== undefined && { primaryColor }),
      ...(accentColor !== undefined && { accentColor }),
    },
  })

  return NextResponse.json(settings)
}
