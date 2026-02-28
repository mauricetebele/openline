/**
 * GET /api/asin-image?asin=B0815627ZC
 *
 * Returns the main product image for an ASIN by querying the SP-API
 * Catalog Items v2022-04-01 endpoint, which returns a direct CDN image URL.
 * Falls back through known static URL patterns if the Catalog API is
 * unavailable or returns no image.
 *
 * The response is a 302 redirect to the image URL so it works directly as
 * an <img src> without any client-side JS.
 *
 * Results are cached for 24 hours via the Cache-Control header.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'

export const dynamic = 'force-dynamic'

// ─── SP-API Catalog Items response shape ──────────────────────────────────────
// GET /catalog/2022-04-01/items/{asin} returns a SINGLE Item object directly,
// not wrapped in an array. (The search endpoint uses items[] but the get-by-asin
// endpoint returns the item at the top level.)

interface CatalogImage {
  variant: string   // "MAIN", "PT01", "PT02", etc.
  link:    string
  height:  number
  width:   number
}
interface CatalogItemResponse {
  asin: string
  images?: Array<{
    marketplaceId: string
    images: CatalogImage[]
  }>
}

// Fallback static URL patterns (some ASINs work with these even without API)
function candidateUrls(asin: string): string[] {
  return [
    `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SX200_.jpg`,
    `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SY200_.jpg`,
    `https://m.media-amazon.com/images/P/${asin}.01._SX200_.jpg`,
    `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.LZZZZZZZ.jpg`,
  ]
}

export async function GET(req: NextRequest) {
  const asin = req.nextUrl.searchParams.get('asin')?.trim()
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
    return new NextResponse(null, { status: 400 })
  }

  // 1. Try SP-API Catalog Items v2022-04-01 — most reliable source
  try {
    const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
    if (account) {
      const client = new SpApiClient(account.id)
      const resp = await client.get<CatalogItemResponse>(
        `/catalog/2022-04-01/items/${asin.toUpperCase()}`,
        {
          marketplaceIds:  account.marketplaceId,
          includedData:    'images',
        },
      )
      // Response is a single Item object — images is a top-level array
      if (resp?.images?.length) {
        // Prefer the marketplace's image set, fall back to the first available
        const marketplaceImages =
          resp.images.find(s => s.marketplaceId === account.marketplaceId)?.images
          ?? resp.images[0]?.images
          ?? []
        const mainImage = marketplaceImages.find(i => i.variant === 'MAIN') ?? marketplaceImages[0]
        if (mainImage?.link) {
          return NextResponse.redirect(mainImage.link, {
            status: 302,
            headers: { 'Cache-Control': 'public, max-age=86400' },
          })
        }
      }
    }
  } catch {
    // Fall through to static candidate URLs
  }

  // 2. Try known static URL patterns in order (HEAD check)
  for (const url of candidateUrls(asin)) {
    try {
      const check = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      })
      if (check.ok) {
        return NextResponse.redirect(url, {
          status: 302,
          headers: { 'Cache-Control': 'public, max-age=86400' },
        })
      }
    } catch {
      continue
    }
  }

  return new NextResponse(null, { status: 404 })
}
