import { NextResponse } from 'next/server'

interface CachedQuote {
  symbol: string
  price: number
  previousClose: number
  change: number
  changePercent: number
  ts: number
}

let cache: CachedQuote | null = null
const CACHE_TTL = 30_000 // 30 seconds

export async function GET() {
  const now = Date.now()
  if (cache && now - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache)
  }

  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/LEU?interval=1d&range=1d',
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 0 },
      },
    )

    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`)

    const json = await res.json()
    const meta = json.chart.result[0].meta
    const price: number = meta.regularMarketPrice
    const previousClose: number = meta.chartPreviousClose
    const change = price - previousClose
    const changePercent = (change / previousClose) * 100

    cache = {
      symbol: 'LEU',
      price,
      previousClose,
      change,
      changePercent,
      ts: now,
    }

    return NextResponse.json(cache)
  } catch {
    // Return stale cache if available
    if (cache) return NextResponse.json(cache)
    return NextResponse.json(
      { error: 'Unable to fetch stock quote' },
      { status: 502 },
    )
  }
}
