import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient, SSLabelForOrderPayload } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

// Minimal single-page blank PDF returned in test mode so the download works
// without making any real API call to Amazon Buy Shipping.
const MOCK_LABEL_PDF_BASE64 =
  'JVBERi0xLjAKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqIDIgMCBv' +
  'YmoKPDwvVHlwZS9QYWdlcy9LaWRzWzMgMCBSXS9Db3VudCAxPj5lbmRvYmogMyAwIG9iago8PC9U' +
  'eXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDI4OCA0MzJdL1BhcmVudCAyIDAgUi9SZXNvdXJjZXM8PC9G' +
  'b250PDwvRjE8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+Pj4+' +
  'Pj4vQ29udGVudHMgNCAwIFI+PmVuZG9iaiA0IDAgb2JqCjw8L0xlbmd0aCAxMDU+PgpzdHJlYW0K' +
  'QlQKL0YxIDI0IFRmCjcyIDM4MCBUZAooVEVTVCBMQUJFTCAtIE5PVCBBIFJFQUwgU0hJUE1FTlQp' +
  'IFRqCi9GMSA5IFRmCjcyIDM2MCBUZAooVGhpcyBsYWJlbCB3YXMgZ2VuZXJhdGVkIGluIHRlc3Qg' +
  'bW9kZSBhbmQgZGlkIG5vdCBjaGFyZ2Ugb3Igc2hpcC4pIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoK' +
  'eHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNj' +
  'EgMDAwMDAgbiAKMDAwMDAwMDExNiAwMDAwMCBuIAowMDAwMDAwMjkzIDAwMDAwIG4gCnRyYWlsZXIK' +
  'PDwvU2l6ZSA1L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKNDUxCiUlRU9G'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
  })
  if (!account) return NextResponse.json({ error: 'No ShipStation account connected' }, { status: 404 })

  const v2ApiKey = account.v2ApiKeyEnc ? decrypt(account.v2ApiKeyEnc) : null
  const client = new ShipStationClient(decrypt(account.apiKeyEnc), decrypt(account.apiSecretEnc), v2ApiKey)

  const body: SSLabelForOrderPayload & { rateId?: string } = await req.json()

  try {
    // ── Test mode for Amazon Buy Shipping ─────────────────────────────────────
    // Amazon has no sandbox — any real API call marks the order as shipped.
    // In test mode we skip the API entirely and return a mock label.
    if (body.testLabel && body.rateId) {
      console.log('[label-for-order] TEST MODE — skipping Amazon Buy Shipping API call')
      return NextResponse.json({
        shipmentId:     0,
        trackingNumber: `TEST-${Date.now()}`,
        labelData:      MOCK_LABEL_PDF_BASE64,
        labelResolution: '300',
        labelFormat:    'pdf',
        shipmentCost:   0,
      })
    }

    // Amazon Buy Shipping labels must go through the V2 API using the rate_id
    if (body.rateId) {
      const label = await client.createLabelV2FromRate(body.rateId, { testLabel: false })
      return NextResponse.json(label)
    }

    // All other carriers — standard V1 createLabelForOrder
    const label = await client.createLabelForOrder(body)
    return NextResponse.json(label)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create label' },
      { status: 502 },
    )
  }
}
