/**
 * GET /api/returns/debug-headers — fetch MFN returns report and return the TSV headers + first row
 * Temporary debug endpoint to identify exact column names.
 */
import { NextResponse } from 'next/server'
import axios from 'axios'
import { gunzip } from 'zlib'
import { promisify } from 'util'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { SpApiClient } from '@/lib/amazon/sp-api'

const gunzipAsync = promisify(gunzip)

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

export const maxDuration = 300

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return NextResponse.json({ error: 'No account' }, { status: 400 })

  const client = new SpApiClient(account.id)
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - 7 * 86_400_000)

  const { reportId } = await client.post<{ reportId: string }>('/reports/2021-06-30/reports', {
    reportType: 'GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE',
    marketplaceIds: [account.marketplaceId],
    dataStartTime: startDate.toISOString(),
    dataEndTime: endDate.toISOString(),
  })

  let reportDocumentId: string | undefined
  for (let i = 0; i < 30; i++) {
    await sleep(10_000)
    const report = await client.get<{ processingStatus: string; reportDocumentId?: string }>(
      `/reports/2021-06-30/reports/${reportId}`,
    )
    if (report.processingStatus === 'DONE') { reportDocumentId = report.reportDocumentId; break }
    if (report.processingStatus === 'FATAL' || report.processingStatus === 'CANCELLED') {
      return NextResponse.json({ error: `Report ${report.processingStatus}` }, { status: 500 })
    }
  }
  if (!reportDocumentId) return NextResponse.json({ error: 'Timed out' }, { status: 500 })

  const docMeta = await client.get<{ url: string; compressionAlgorithm?: string }>(
    `/reports/2021-06-30/documents/${reportDocumentId}`,
  )
  const response = await axios.get<ArrayBuffer>(docMeta.url, { responseType: 'arraybuffer' })
  let buffer = Buffer.from(response.data)
  if (docMeta.compressionAlgorithm === 'GZIP') buffer = await gunzipAsync(buffer)

  const tsvText = buffer.toString('utf-8').replace(/^\uFEFF/, '')
  const lines = tsvText.split('\n')
  const headers = lines[0]?.split('\t').map((h) => h.trim()) ?? []

  // Build sample from first data row
  const firstRowCells = lines[1]?.split('\t') ?? []
  const sample: Record<string, string> = {}
  headers.forEach((h, i) => { sample[h] = firstRowCells[i]?.trim() ?? '' })

  return NextResponse.json({
    headerCount: headers.length,
    headers,
    headersLower: headers.map(h => h.toLowerCase()),
    sampleRow: sample,
    totalDataRows: lines.length - 1,
  })
}
