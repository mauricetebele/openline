/**
 * Google OAuth + Gmail REST helpers for the in-app email client.
 * Uses the Gmail REST API directly (no googleapis dependency). OAuth client
 * credentials come from env: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.
 */
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/crypto'

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify', // read + label + trash
  'https://www.googleapis.com/auth/gmail.send',   // send
  'https://www.googleapis.com/auth/gmail.labels',  // manage labels/folders
  'openid', 'email', 'profile',
].join(' ')

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** OAuth client creds — from the Settings-stored config, falling back to env. */
export async function getGoogleCreds(): Promise<{ clientId: string; clientSecret: string } | null> {
  const cfg = await prisma.googleOAuthConfig.findUnique({ where: { id: 'singleton' } }).catch(() => null)
  const clientId = cfg?.clientIdEnc ? decrypt(cfg.clientIdEnc) : process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = cfg?.clientSecretEnc ? decrypt(cfg.clientSecretEnc) : process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export async function googleConfigured(): Promise<boolean> {
  return !!(await getGoogleCreds())
}

export function buildAuthUrl(redirectUri: string, state: string, clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',   // get a refresh token
    prompt: 'consent',        // force refresh_token on re-auth
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  id_token?: string
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const creds = await getGoogleCreds()
  if (!creds) throw new Error('Google OAuth is not configured')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`)
  return res.json()
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const creds = await getGoogleCreds()
  if (!creds) throw new Error('Google OAuth is not configured')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)
  return res.json()
}

/** Decode a JWT id_token payload (no signature verification — Google-issued). */
export function decodeIdToken(idToken?: string): { email?: string; name?: string; picture?: string } {
  if (!idToken) return {}
  try {
    const payload = idToken.split('.')[1]
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(json)
  } catch { return {} }
}

/** Return a valid access token for an account, refreshing + persisting if needed. */
export async function getAccessToken(accountId: string): Promise<string> {
  const acct = await prisma.emailAccount.findUnique({ where: { id: accountId } })
  if (!acct) throw new Error('Email account not found')

  const stillValid = acct.accessTokenEnc && acct.tokenExpiry && acct.tokenExpiry.getTime() - Date.now() > 60_000
  if (stillValid) return decrypt(acct.accessTokenEnc!)

  if (!acct.refreshTokenEnc) throw new Error('Account needs to be reconnected (no refresh token)')
  const refreshed = await refreshAccessToken(decrypt(acct.refreshTokenEnc))
  const expiry = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000)
  await prisma.emailAccount.update({
    where: { id: accountId },
    data: { accessTokenEnc: encrypt(refreshed.access_token), tokenExpiry: expiry },
  })
  return refreshed.access_token
}

/** Persist a fresh token set onto (or create) an account. */
export async function saveAccountTokens(email: string, displayName: string | undefined, tokens: TokenResponse, byLabel?: string) {
  const expiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000)
  const data = {
    displayName: displayName ?? null,
    accessTokenEnc: encrypt(tokens.access_token),
    tokenExpiry: expiry,
    scope: tokens.scope ?? GMAIL_SCOPES,
    active: true,
    connectedByLabel: byLabel ?? null,
    ...(tokens.refresh_token ? { refreshTokenEnc: encrypt(tokens.refresh_token) } : {}),
  }
  return prisma.emailAccount.upsert({
    where: { email },
    create: { email, provider: 'google', ...data },
    update: data,
  })
}

// ── Gmail REST ────────────────────────────────────────────────────────────────

async function gmailFetch(accountId: string, path: string, init?: RequestInit): Promise<unknown> {
  const token = await getAccessToken(accountId)
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

export interface GmailListItem { id: string; threadId: string }
export async function listMessages(accountId: string, opts: { q?: string; labelIds?: string[]; pageToken?: string; maxResults?: number }) {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  ;(opts.labelIds ?? []).forEach(l => params.append('labelIds', l))
  if (opts.pageToken) params.set('pageToken', opts.pageToken)
  params.set('maxResults', String(opts.maxResults ?? 25))
  return gmailFetch(accountId, `/messages?${params.toString()}`) as Promise<{ messages?: GmailListItem[]; nextPageToken?: string; resultSizeEstimate?: number }>
}

export async function getMessage(accountId: string, id: string, format: 'full' | 'metadata' | 'minimal' = 'full') {
  return gmailFetch(accountId, `/messages/${id}?format=${format}`)
}

export async function modifyMessage(accountId: string, id: string, body: { addLabelIds?: string[]; removeLabelIds?: string[] }) {
  return gmailFetch(accountId, `/messages/${id}/modify`, { method: 'POST', body: JSON.stringify(body) })
}

export async function trashMessage(accountId: string, id: string) {
  return gmailFetch(accountId, `/messages/${id}/trash`, { method: 'POST' })
}

export async function listLabels(accountId: string) {
  return gmailFetch(accountId, '/labels') as Promise<{ labels?: { id: string; name: string; type: string; messagesUnread?: number }[] }>
}

export async function sendRawMessage(accountId: string, rawBase64Url: string, threadId?: string) {
  return gmailFetch(accountId, '/messages/send', { method: 'POST', body: JSON.stringify({ raw: rawBase64Url, ...(threadId ? { threadId } : {}) }) })
}
