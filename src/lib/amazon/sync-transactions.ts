/**
 * Sync ALL financial transactions from Amazon SP-API Finances v2 endpoint.
 *
 * Uses /finances/2024-06-19/transactions to pull every credit and debit
 * (Shipment, Refund, ServiceFee, Adjustment, Transfer, etc.) and stores
 * them in the AmazonTransaction table for a complete Transaction View.
 *
 * Deduplicates via SHA-256 hash of key fields.
 */

import { createHash } from 'crypto'
import { Decimal } from '@prisma/client/runtime/library'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── SP-API types (Finances v2024-06-19) ─────────────────────────────────────

interface CurrencyAmount {
  currencyCode?: string
  currencyAmount?: number
}

interface Breakdown {
  breakdownType?: string
  breakdownAmount?: CurrencyAmount
  breakdowns?: Breakdown[] | null
}

interface RelatedIdentifier {
  relatedIdentifierName?: string
  relatedIdentifierValue?: string
}

interface V2Transaction {
  transactionType?: string
  transactionStatus?: string
  postedDate?: string
  totalAmount?: CurrencyAmount
  description?: string
  relatedIdentifiers?: RelatedIdentifier[]
  breakdowns?: Breakdown[]
  contexts?: Record<string, unknown>[]
}

interface V2Response {
  payload: {
    transactions?: V2Transaction[]
    nextToken?: string
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeDedupHash(
  accountId: string,
  postedDate: string,
  transactionType: string,
  transactionStatus: string,
  totalAmount: number,
  orderId: string | null,
): string {
  const raw = [accountId, postedDate, transactionType, transactionStatus, totalAmount.toString(), orderId ?? ''].join('|')
  return createHash('sha256').update(raw).digest('hex')
}

// ─── Main sync function ─────────────────────────────────────────────────────

export async function syncAmazonTransactions(
  accountId: string,
  startDate: Date,
  endDate: Date,
  jobId?: string,
): Promise<{ found: number; upserted: number }> {
  const client = new SpApiClient(accountId)

  // Fetch all transactions from Finances v2
  const allTransactions: V2Transaction[] = []
  let nextToken: string | undefined

  do {
    const params: Record<string, string> = {
      postedAfter: startDate.toISOString(),
      postedBefore: endDate.toISOString(),
      marketplaceId: 'ATVPDKIKX0DER',
    }
    if (nextToken) params['nextToken'] = nextToken

    const resp = await client.get<V2Response>(
      '/finances/2024-06-19/transactions',
      params,
    )

    const txns = resp.payload?.transactions ?? []
    allTransactions.push(...txns)
    nextToken = resp.payload?.nextToken

    if (nextToken) await sleep(2_100) // 0.5 req/s burst 10
  } while (nextToken)

  // Update job progress — total found
  if (jobId) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: { totalFound: allTransactions.length },
    })
  }

  // Upsert each transaction
  let upserted = 0

  for (const txn of allTransactions) {
    const postedDate = txn.postedDate ?? new Date().toISOString()
    const transactionType = txn.transactionType ?? 'Unknown'
    const transactionStatus = txn.transactionStatus ?? 'UNKNOWN'
    const amount = txn.totalAmount?.currencyAmount ?? 0
    const currency = txn.totalAmount?.currencyCode ?? 'USD'

    // Extract orderId and shipmentId from relatedIdentifiers
    const orderId = txn.relatedIdentifiers?.find(
      (r) => r.relatedIdentifierName === 'ORDER_ID',
    )?.relatedIdentifierValue ?? null

    const shipmentId = txn.relatedIdentifiers?.find(
      (r) => r.relatedIdentifierName === 'SHIPMENT_ID',
    )?.relatedIdentifierValue ?? null

    const creditOrDebit = amount >= 0 ? 'CREDIT' : 'DEBIT'

    const dedupHash = computeDedupHash(
      accountId,
      postedDate,
      transactionType,
      transactionStatus,
      amount,
      orderId,
    )

    const description = txn.description ?? null

    await prisma.amazonTransaction.upsert({
      where: { dedupHash },
      create: {
        accountId,
        transactionType,
        transactionStatus,
        postedDate: new Date(postedDate),
        totalAmount: new Decimal(amount.toFixed(2)),
        currency,
        description,
        creditOrDebit,
        orderId,
        shipmentId,
        relatedIdentifiers: txn.relatedIdentifiers as unknown as undefined,
        breakdowns: txn.breakdowns as unknown as undefined,
        contexts: txn.contexts as unknown as undefined,
        dedupHash,
      },
      update: {
        transactionStatus,
        totalAmount: new Decimal(amount.toFixed(2)),
        description,
        breakdowns: txn.breakdowns as unknown as undefined,
        contexts: txn.contexts as unknown as undefined,
      },
    })

    upserted++

    // Update job progress periodically
    if (jobId && upserted % 50 === 0) {
      await prisma.importJob.update({
        where: { id: jobId },
        data: { totalUpserted: upserted },
      })
    }
  }

  // Final job update
  if (jobId) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        totalUpserted: upserted,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    })
  }

  console.log(`[sync-transactions] account=${accountId}: ${allTransactions.length} fetched, ${upserted} upserted`)
  return { found: allTransactions.length, upserted }
}
