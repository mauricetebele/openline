/**
 * Google Cloud Identity Platform (Firebase Auth) admin via an admin user's OAuth
 * token — no service-account key required (useful when the org blocks key
 * creation). One admin authorizes once; their refresh token is stored encrypted
 * and used to set other users' passwords via the GCIP admin REST API. That admin
 * must hold the Firebase Authentication Admin role on the project.
 */
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/crypto'
import { getGoogleCreds } from '@/lib/email/google'

// cloud-platform covers the GCIP admin endpoints; openid/email identify the admin.
export const GCIP_ADMIN_SCOPES = 'https://www.googleapis.com/auth/cloud-platform openid email'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const IDTK = 'https://identitytoolkit.googleapis.com/v1'

function projectId(): string {
  const id = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  if (!id) throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set')
  return id
}

export function buildAdminAuthUrl(redirectUri: string, state: string, clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GCIP_ADMIN_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; id_token?: string }

export async function exchangeAdminCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const creds = await getGoogleCreds()
  if (!creds) throw new Error('Google OAuth is not configured')
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`)
  return res.json()
}

export async function saveAdminOAuth(email: string | undefined, refreshToken: string) {
  await prisma.firebaseAdminConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', adminOauthEmail: email ?? null, adminOauthRefreshTokenEnc: encrypt(refreshToken) },
    update: { adminOauthEmail: email ?? null, adminOauthRefreshTokenEnc: encrypt(refreshToken) },
  })
}

export async function adminOAuthEmail(): Promise<string | null> {
  const cfg = await prisma.firebaseAdminConfig.findUnique({ where: { id: 'singleton' }, select: { adminOauthEmail: true, adminOauthRefreshTokenEnc: true } }).catch(() => null)
  return cfg?.adminOauthRefreshTokenEnc ? (cfg.adminOauthEmail ?? 'connected') : null
}

/** Mint an access token from the stored admin refresh token, or null if unset. */
async function getAdminAccessToken(): Promise<string | null> {
  const cfg = await prisma.firebaseAdminConfig.findUnique({ where: { id: 'singleton' }, select: { adminOauthRefreshTokenEnc: true } }).catch(() => null)
  if (!cfg?.adminOauthRefreshTokenEnc) return null
  const creds = await getGoogleCreds()
  if (!creds) return null
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: decrypt(cfg.adminOauthRefreshTokenEnc), client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: 'refresh_token' }),
  })
  if (!res.ok) throw new Error(`Admin token refresh failed: ${await res.text()}`)
  const d = await res.json()
  return d.access_token as string
}

export async function adminOAuthConfigured(): Promise<boolean> {
  const cfg = await prisma.firebaseAdminConfig.findUnique({ where: { id: 'singleton' }, select: { adminOauthRefreshTokenEnc: true } }).catch(() => null)
  return !!cfg?.adminOauthRefreshTokenEnc
}

async function lookupUid(accessToken: string, email: string): Promise<string | null> {
  const res = await fetch(`${IDTK}/projects/${projectId()}/accounts:lookup`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: [email] }),
  })
  if (!res.ok) throw new Error(`Lookup failed: ${await res.text()}`)
  const d = await res.json() as { users?: { localId?: string }[] }
  return d.users?.[0]?.localId ?? null
}

/**
 * Set a user's password using the admin OAuth token. Returns true on success.
 * Throws if OAuth admin isn't configured or the API rejects (e.g. the admin
 * lacks the Firebase Authentication Admin role).
 */
export async function setPasswordViaOAuth(uidOrNull: string | null, email: string, newPassword: string): Promise<boolean> {
  const token = await getAdminAccessToken()
  if (!token) throw new Error('Admin Google account not authorized')
  const uid = uidOrNull || (await lookupUid(token, email))
  if (!uid) throw new Error('User not found in Firebase')
  const res = await fetch(`${IDTK}/projects/${projectId()}/accounts:update`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, password: newPassword }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Set password failed: ${t.slice(0, 300)}`)
  }
  return true
}
