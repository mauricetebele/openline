/**
 * SP-API base client.
 *
 * Handles:
 *  - Automatic access-token refresh (LWA)
 *  - Exponential-backoff retry on 429 / 503
 *  - NextToken pagination (call fetchAllPages)
 *  - Per-account token refresh synced through DB
 */
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { prisma } from '@/lib/prisma'
import { decrypt, encrypt } from '@/lib/crypto'
import { refreshAccessToken } from './lwa'

const ENDPOINT = process.env.AMAZON_API_ENDPOINT ?? 'https://sellingpartnerapi-na.amazon.com'

/** Maximum retry attempts on throttle / transient error */
const MAX_RETRIES = 5
/** Base delay ms for exponential backoff */
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
      console.warn(`SP-API throttled (${status}). Retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delay)}ms`)
      await sleep(delay)
      return withRetry(fn, attempt + 1)
    }
    console.error('[SP-API] Error:', status, JSON.stringify(res?.data))
    throw new Error(`SP-API error (${status}): ${JSON.stringify(res?.data)}`)
  }
}

export class SpApiClient {
  private accountId: string
  private http: AxiosInstance
  private accessToken = ''
  private tokenExpiresAt = new Date(0)

  constructor(accountId: string) {
    this.accountId = accountId
    this.http = axios.create({ baseURL: ENDPOINT, timeout: 30_000 })
  }

  private async ensureFreshToken(): Promise<void> {
    // Refresh 60 s before actual expiry
    if (new Date() < new Date(this.tokenExpiresAt.getTime() - 60_000)) return

    const account = await prisma.amazonAccount.findUniqueOrThrow({
      where: { id: this.accountId },
    })

    const refreshToken = decrypt(account.refreshTokenEnc)
    const tokens = await refreshAccessToken(refreshToken)

    // Persist refreshed tokens
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1_000)
    await prisma.amazonAccount.update({
      where: { id: this.accountId },
      data: {
        accessTokenEnc: encrypt(tokens.access_token),
        tokenExpiresAt: expiresAt,
      },
    })

    this.accessToken = tokens.access_token
    this.tokenExpiresAt = expiresAt
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    await this.ensureFreshToken()
    const config: AxiosRequestConfig = {
      params,
      headers: {
        'x-amz-access-token': this.accessToken,
        'Content-Type': 'application/json',
      },
    }
    return withRetry(async () => {
      const { data } = await this.http.get<T>(path, config)
      return data
    })
  }

  async post<T>(path: string, body: unknown, params?: Record<string, string>): Promise<T> {
    await this.ensureFreshToken()
    const config: AxiosRequestConfig = {
      params,
      headers: {
        'x-amz-access-token': this.accessToken,
        'Content-Type': 'application/json',
      },
    }
    return withRetry(async () => {
      const { data } = await this.http.post<T>(path, body, config)
      return data
    })
  }

  async put<T>(path: string, body: unknown, params?: Record<string, string>): Promise<T> {
    await this.ensureFreshToken()
    const config: AxiosRequestConfig = {
      params,
      headers: {
        'x-amz-access-token': this.accessToken,
        'Content-Type': 'application/json',
      },
    }
    return withRetry(async () => {
      const { data } = await this.http.put<T>(path, body, config)
      return data
    })
  }

  async delete<T = void>(path: string, params?: Record<string, string>): Promise<T> {
    await this.ensureFreshToken()
    const config: AxiosRequestConfig = {
      params,
      headers: {
        'x-amz-access-token': this.accessToken,
        'Content-Type': 'application/json',
      },
    }
    return withRetry(async () => {
      const { data } = await this.http.delete<T>(path, config)
      return data
    })
  }

  async patch<T>(path: string, body: unknown, params?: Record<string, string>): Promise<T> {
    await this.ensureFreshToken()
    const config: AxiosRequestConfig = {
      params,
      headers: {
        'x-amz-access-token': this.accessToken,
        'Content-Type': 'application/json',
      },
    }
    return withRetry(async () => {
      const { data } = await this.http.patch<T>(path, body, config)
      return data
    })
  }

  /**
   * Obtain a Restricted Data Token for accessing PII / restricted fields
   * (e.g. buyerInfo, shippingAddress).  The returned token replaces the
   * regular access token in subsequent requests.
   */
  async getRestrictedDataToken(
    restrictedResources: { method: string; path: string; dataElements?: string[] }[],
  ): Promise<string> {
    await this.ensureFreshToken()
    const { data } = await this.http.post<{ restrictedDataToken: string }>(
      '/tokens/2021-03-01/restrictedDataToken',
      { restrictedResources },
      {
        headers: {
          'x-amz-access-token': this.accessToken,
          'Content-Type': 'application/json',
        },
      },
    )
    return data.restrictedDataToken
  }

  /**
   * GET with a pre-fetched Restricted Data Token instead of the regular LWA token.
   */
  async getWithRDT<T>(path: string, rdt: string, params?: Record<string, string>): Promise<T> {
    const config: AxiosRequestConfig = {
      params,
      headers: {
        'x-amz-access-token': rdt,
        'Content-Type': 'application/json',
      },
    }
    return withRetry(async () => {
      const { data } = await this.http.get<T>(path, config)
      return data
    })
  }

  /**
   * Fetch all paginated pages using SP-API NextToken pattern.
   * The SDK returns { payload: { [listKey]: T[], NextToken?: string } }
   */
  async fetchAllPages<T>(
    path: string,
    listKey: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const results: T[] = []
    let nextToken: string | undefined

    do {
      const queryParams: Record<string, string> = { ...params }
      if (nextToken) queryParams['NextToken'] = nextToken

      const response = await this.get<{ payload: Record<string, unknown> }>(path, queryParams)
      const page = response.payload?.[listKey] as T[] | undefined
      if (page?.length) results.push(...page)
      nextToken = response.payload?.['NextToken'] as string | undefined

      // Respect approximate rate limits — Finances API: 0.5 req/s
      if (nextToken) await sleep(2_100)
    } while (nextToken)

    return results
  }
}
