/**
 * Sync ALL financial transactions from Amazon SP-API Finances v2 endpoint.
 *
 * Uses /finances/2024-06-19/transactions to pull every credit and debit
 * (Shipment, Refund, ServiceFee, Adjustment, Transfer, etc.) and stores
 * them in the AmazonTransaction table for a complete Transaction View.
 *
 * Deduplicates via SHA-256 hash of key fields.
 * Uses batch raw SQL upserts (INSERT ... ON CONFLICT) for speed.
 */

import { createHash } from 'crypto'
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

// ─── Parsed row ready for DB ────────────────────────────────────────────────

interface ParsedTransaction {
  accountId: string
  transactionType: string
  transactionStatus: string
  postedDate: Date
  totalAmount: number
  currency: string
  description: string | null
  creditOrDebit: string
  orderId: string | null
  shipmentId: string | null
  relatedIdentifiers: string | null // JSON string
  breakdowns: string | null         // JSON string
  contexts: string | null           // JSON string
  dedupHash: string
}

// ─── Main sync function ─────────────────────────────────────────────────────

const BATCH_SIZE = 100
const COLS_PER_ROW = 14 // number of $N placeholders per row

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

  // Parse all transactions into DB-ready rows
  const parsed: ParsedTransaction[] = allTransactions.map((txn) => {
    const postedDate = txn.postedDate ?? new Date().toISOString()
    const transactionType = txn.transactionType ?? 'Unknown'
    const transactionStatus = txn.transactionStatus ?? 'UNKNOWN'
    const amount = txn.totalAmount?.currencyAmount ?? 0
    const currency = txn.totalAmount?.currencyCode ?? 'USD'

    const orderId = txn.relatedIdentifiers?.find(
      (r) => r.relatedIdentifierName === 'ORDER_ID',
    )?.relatedIdentifierValue ?? null

    const shipmentId = txn.relatedIdentifiers?.find(
      (r) => r.relatedIdentifierName === 'SHIPMENT_ID',
    )?.relatedIdentifierValue ?? null

    return {
      accountId,
      transactionType,
      transactionStatus,
      postedDate: new Date(postedDate),
      totalAmount: Number(amount.toFixed(2)),
      currency,
      description: txn.description ?? null,
      creditOrDebit: amount >= 0 ? 'CREDIT' : 'DEBIT',
      orderId,
      shipmentId,
      relatedIdentifiers: txn.relatedIdentifiers ? JSON.stringify(txn.relatedIdentifiers) : null,
      breakdowns: txn.breakdowns ? JSON.stringify(txn.breakdowns) : null,
      contexts: txn.contexts ? JSON.stringify(txn.contexts) : null,
      dedupHash: computeDedupHash(accountId, postedDate, transactionType, transactionStatus, amount, orderId),
    }
  })

  // Batch upsert using raw SQL (INSERT ... ON CONFLICT)
  let totalUpserted = 0
  const now = new Date()

  for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
    const batch = parsed.slice(i, i + BATCH_SIZE)

    const values: unknown[] = []
    const placeholders: string[] = []

    for (const row of batch) {
      const o = values.length // offset
      placeholders.push(
        `(gen_random_uuid(), $${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6}, $${o+7}, $${o+8}, $${o+9}, $${o+10}, $${o+11}, $${o+12}::jsonb, $${o+13}::jsonb, $${o+14}::jsonb, NOW(), NOW())`,
      )
      values.push(
        row.accountId,          // 1
        row.transactionType,    // 2
        row.transactionStatus,  // 3
        row.postedDate,         // 4
        row.totalAmount,        // 5
        row.currency,           // 6
        row.description,        // 7
        row.creditOrDebit,      // 8
        row.orderId,            // 9
        row.shipmentId,         // 10
        row.dedupHash,          // 11
        row.relatedIdentifiers, // 12
        row.breakdowns,         // 13
        row.contexts,           // 14
      )
    }

    const sql = `
      INSERT INTO amazon_transactions (
        id, "accountId", "transactionType", "transactionStatus",
        "postedDate", "totalAmount", currency, description,
        "creditOrDebit", "orderId", "shipmentId", "dedupHash",
        "relatedIdentifiers", breakdowns, contexts, "importedAt", "updatedAt"
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT ("dedupHash") DO UPDATE SET
        "transactionStatus" = EXCLUDED."transactionStatus",
        "totalAmount" = EXCLUDED."totalAmount",
        description = EXCLUDED.description,
        breakdowns = EXCLUDED.breakdowns,
        contexts = EXCLUDED.contexts,
        "updatedAt" = NOW()
    `

    await prisma.$executeRawUnsafe(sql, ...values)
    totalUpserted += batch.length

    // Update job progress every batch
    if (jobId) {
      await prisma.importJob.update({
        where: { id: jobId },
        data: { totalUpserted },
      })
    }
  }

  // Final job update
  if (jobId) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        totalUpserted,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    })
  }

  console.log(`[sync-transactions] account=${accountId}: ${allTransactions.length} fetched, ${totalUpserted} upserted in ${Math.ceil(parsed.length / BATCH_SIZE)} batches`)
  return { found: allTransactions.length, upserted: totalUpserted }
}
