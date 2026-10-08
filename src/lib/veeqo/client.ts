/**
 * Veeqo API client. Single API key (x-api-key) for the whole account.
 * Base URL: https://api.veeqo.com. Key generated in Veeqo → Settings → Users →
 * (your user) → API key.
 *
 * Phase 1 covers connectivity (auth + a test call). Rate-shopping and label
 * purchase build on veeqoFetch in a later pass.
 */
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'

const BASE = 'https://api.veeqo.com'

/** Decrypted API key of the active Veeqo credential, or null if not configured. */
export async function loadVeeqoApiKey(): Promise<string | null> {
  const row = await prisma.veeqoCredential.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!row?.apiKeyEnc) return null
  try { return decrypt(row.apiKeyEnc) } catch { return null }
}

/** Authenticated Veeqo request. Pass apiKey to test a key before it's saved. */
export async function veeqoFetch<T>(path: string, init: RequestInit = {}, apiKey?: string): Promise<T> {
  const key = apiKey ?? await loadVeeqoApiKey()
  if (!key) throw new Error('Veeqo API key not configured')
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { accept: 'application/json', 'x-api-key': key, ...(init.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Veeqo ${path} failed (${res.status})${body ? `: ${body.slice(0, 300)}` : ''}`)
  }
  return res.json() as Promise<T>
}

/**
 * Validate an API key against Veeqo. Hits /orders (confirmed endpoint) to verify
 * auth, then best-effort counts delivery methods (the carriers/services available
 * for buying labels later). Never throws — returns a result object.
 */
export async function testVeeqoConnection(apiKey?: string): Promise<{
  ok: boolean
  status?: number
  error?: string
  deliveryMethods?: number
}> {
  try {
    await veeqoFetch('/orders?page_size=1', {}, apiKey)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Connection failed'
    const m = msg.match(/\((\d{3})\)/)
    return { ok: false, status: m ? Number(m[1]) : undefined, error: msg }
  }
  let deliveryMethods: number | undefined
  try {
    const dm = await veeqoFetch<unknown[]>('/delivery_methods', {}, apiKey)
    if (Array.isArray(dm)) deliveryMethods = dm.length
  } catch { /* non-fatal */ }
  return { ok: true, deliveryMethods }
}
