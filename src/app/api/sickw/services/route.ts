/**
 * GET /api/sickw/services — list SICKW services (id, name, price) for the picker.
 * Cached in-memory briefly to avoid hammering SICKW on every dropdown open.
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

interface SickwService { id: number; name: string; price: number }

let cache: { at: number; services: SickwService[] } | null = null
const TTL_MS = 10 * 60 * 1000

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .trim()
}

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ services: cache.services })
  }

  const cred = await prisma.sickwCredential.findFirst({ where: { isActive: true } })
  if (!cred) return NextResponse.json({ error: 'SICKW API key not configured. Go to Settings > SICKW to add it.' }, { status: 400 })

  let apiKey: string
  try { apiKey = decrypt(cred.apiKeyEnc) } catch { return NextResponse.json({ error: 'Failed to decrypt API key' }, { status: 500 }) }

  try {
    const url = `https://sickw.com/api.php?action=services&key=${encodeURIComponent(apiKey)}&format=json`
    const res = await fetch(url, { cache: 'no-store' })
    const json = await res.json() as Record<string, unknown>
    // Response shape: { "Service List": [ { service, name, price } ] }
    const list = (json['Service List'] ?? json['services'] ?? json['list']) as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(list)) {
      return NextResponse.json({ error: 'Unexpected SICKW services response' }, { status: 502 })
    }
    const services: SickwService[] = list
      .map(s => ({
        id: Number(s.service ?? s.id),
        name: decodeEntities(String(s.name ?? s.service_name ?? '')),
        price: Number(s.price ?? 0),
      }))
      .filter(s => Number.isFinite(s.id) && s.name)
      .sort((a, b) => a.name.localeCompare(b.name))

    cache = { at: Date.now(), services }
    return NextResponse.json({ services })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load services' }, { status: 500 })
  }
}
