/**
 * DEBUG endpoint — returns raw FedEx Track API response for a tracking number.
 * GET /api/fedex/debug-track?tn=399315766291
 * Remove this endpoint after debugging.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import axios from 'axios'

export const dynamic = 'force-dynamic'

const FEDEX_AUTH_URL  = 'https://apis.fedex.com/oauth/token'
const FEDEX_TRACK_URL = 'https://apis.fedex.com/track/v1/tracknumbers'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tn = req.nextUrl.searchParams.get('tn')
  if (!tn) return NextResponse.json({ error: 'tn query param required' }, { status: 400 })

  // 1. Load credentials
  const cred = await prisma.fedexCredential.findFirst({ where: { isActive: true } })
  if (!cred) return NextResponse.json({ error: 'No FedEx credentials configured' }, { status: 400 })

  const clientId = decrypt(cred.clientIdEnc)
  const clientSecret = decrypt(cred.clientSecretEnc)

  // 2. Get OAuth token
  let token: string
  try {
    const authRes = await axios.post(
      FEDEX_AUTH_URL,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    )
    token = authRes.data.access_token
  } catch (e: unknown) {
    const axErr = e as { response?: { status?: number; data?: unknown } }
    return NextResponse.json({
      step: 'oauth',
      status: axErr?.response?.status,
      data: axErr?.response?.data,
    }, { status: 502 })
  }

  // 3. Call Track API
  const trackBody = {
    includeDetailedScans: true,
    trackingInfo: [
      { trackingNumberInfo: { trackingNumber: tn } },
    ],
  }

  try {
    const trackRes = await axios.post(FEDEX_TRACK_URL, trackBody, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_US',
      },
    })
    return NextResponse.json({
      step: 'track',
      httpStatus: trackRes.status,
      body: trackRes.data,
    })
  } catch (e: unknown) {
    const axErr = e as { response?: { status?: number; data?: unknown } }
    return NextResponse.json({
      step: 'track',
      httpStatus: axErr?.response?.status,
      errorBody: axErr?.response?.data,
    }, { status: 502 })
  }
}
