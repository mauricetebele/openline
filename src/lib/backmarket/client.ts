/**
 * BackMarket API client.
 *
 * Handles:
 *  - Basic auth via decrypted API key
 *  - Exponential-backoff retry on 429 / 503
 *  - Page-based pagination (GET ?page=1,2,3… until `next` is null)
 */
import axios, { AxiosInstance } from 'axios'

const BASE_URL = 'https://www.backmarket.com/ws'

const MAX_RETRIES = 5
const BASE_DELAY_MS = 1_000

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn()
  } catch (err: unknown) {
    const res = (err as { response?: { status?: number; data?: unknown } })?.response
    const status = res?.status
    if ((status === 429 || status === 503) && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 500
      console.warn(`BackMarket API throttled (${status}). Retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delay)}ms`)
      await sleep(delay)
      return withRetry(fn, attempt + 1)
    }
    console.error('[BackMarket] Error:', status, JSON.stringify(res?.data))
    throw new Error(`BackMarket API error (${status}): ${JSON.stringify(res?.data)}`)
  }
}

export const BM_CONDITION_TO_STATE: Record<string, number> = {
  Excellent: 0,
  Good: 2,
  Stallone: 3,
}

export class BackMarketClient {
  private http: AxiosInstance

  constructor(apiKey: string) {
    this.http = axios.create({
      baseURL: BASE_URL,
      timeout: 30_000,
      headers: {
        'Authorization': `Basic ${apiKey}`,
        'Accept': 'application/json',
        'Accept-Language': 'en-us',
      },
    })
  }

  async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    return withRetry(async () => {
      const { data } = await this.http.get<T>(path, { params })
      return data
    })
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return withRetry(async () => {
      const { data } = await this.http.post<T>(path, body)
      return data
    })
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return withRetry(async () => {
      const { data } = await this.http.patch<T>(path, body)
      return data
    })
  }

  /**
   * Update stock quantity for a Back Market listing by its listing ID.
   */
  async updateListingQuantity(listingId: number, quantity: number): Promise<void> {
    await this.post(`/listings/${listingId}`, { quantity })
    console.log(`[BackMarket] Updated listing ${listingId} quantity to ${quantity}`)
  }

  /**
   * Create new listings on BackMarket via CSV-style POST /ws/listings.
   */
  async createListings(rows: { sku: string; backmarketId: number; price: number; quantity: number; state: number }[]) {
    const header = 'sku;backmarket_id;price;quantity;state'
    const lines = rows.map(r => `${r.sku};${r.backmarketId};${r.price};${r.quantity};${r.state}`)
    const catalog = [header, ...lines].join('\n')
    return this.post<{ bodymessage: number; statuscode: number }>('/listings', {
      encoding: 'latin1',
      delimiter: ';',
      quotechar: '"',
      header: true,
      catalog,
    })
  }

  /**
   * Fetch all pages from a paginated BackMarket endpoint.
   * BM uses `?page=N` pagination with a `next` field indicating more pages.
   * The response contains a `results` array with the items.
   */
  async fetchAllPages<T>(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<T[]> {
    const results: T[] = []
    let page = 1

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resp = await this.get<{ results?: T[]; next?: string | null }>(
        path,
        { ...params, page },
      )
      if (resp.results?.length) results.push(...resp.results)
      if (!resp.next) break
      page++
      // Small delay between pages to be respectful of rate limits
      await sleep(500)
    }

    return results
  }
}
