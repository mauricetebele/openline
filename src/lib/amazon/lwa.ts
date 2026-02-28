/**
 * Login with Amazon (LWA) — OAuth 2.0 helpers for SP-API authorization.
 *
 * Flow:
 * 1. Redirect seller to Seller Central consent URL
 * 2. Amazon redirects back with ?spapi_oauth_code=&selling_partner_id=
 * 3. Exchange spapi_oauth_code for access_token + refresh_token via LWA token endpoint
 * 4. Store encrypted tokens; refresh access_token when it expires (TTL = 1 h)
 *
 * Required SP-API roles for this app:
 *   - "Selling partner insights" → grants sellingpartnerapi:finances (Finances API v0)
 *   - "Direct-to-consumer shipping" → grants orders:read (Orders API v0)
 *
 * Register your app at: https://developer.amazon.com/apps/manage
 */
import axios from 'axios'
import type { LwaTokenResponse } from '@/types'

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
const SELLER_CENTRAL_BASE = 'https://sellercentral.amazon.com'

export function buildConsentUrl(state: string): string {
  const params = new URLSearchParams({
    application_id: process.env.AMAZON_APP_ID!,
    state,
    version: 'beta',
    redirect_uri: process.env.AMAZON_REDIRECT_URI!,
  })
  return `${SELLER_CENTRAL_BASE}/apps/authorize/consent?${params.toString()}`
}

/** Exchange the one-time OAuth code for LWA tokens. */
export async function exchangeCodeForTokens(code: string): Promise<LwaTokenResponse> {
  const { data } = await axios.post<LwaTokenResponse>(
    LWA_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.AMAZON_CLIENT_ID!,
      client_secret: process.env.AMAZON_CLIENT_SECRET!,
      redirect_uri: process.env.AMAZON_REDIRECT_URI!,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  )
  return data
}

/** Use the refresh token to get a new short-lived access token. */
export async function refreshAccessToken(refreshToken: string): Promise<LwaTokenResponse> {
  try {
    const { data } = await axios.post<LwaTokenResponse>(
      LWA_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.AMAZON_CLIENT_ID!,
        client_secret: process.env.AMAZON_CLIENT_SECRET!,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    )
    return data
  } catch (err: unknown) {
    const res = (err as { response?: { data?: unknown; status?: number } })?.response
    console.error('[LWA] Token refresh failed:', res?.status, JSON.stringify(res?.data))
    throw new Error(`LWA token refresh failed (${res?.status}): ${JSON.stringify(res?.data)}`)
  }
}
