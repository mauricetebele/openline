/**
 * POST /api/products/import
 * Accepts a multipart/form-data upload with a single "file" field (CSV or XLSX).
 *
 * Expected columns (case-insensitive, order flexible):
 *   description | sku | serializable (yes/no/true/false/1/0)
 *
 * Returns:
 *   { created: number, skipped: number, errors: { row: number, sku: string, reason: string }[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

interface RowError { row: number; sku: string; reason: string }

function parseBool(val: unknown): boolean | null {
  if (val === null || val === undefined || String(val).trim() === '') return null
  const s = String(val).trim().toLowerCase()
  if (['yes', 'true', '1', 'y'].includes(s)) return true
  if (['no', 'false', '0', 'n'].includes(s)) return false
  return null
}

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!['csv', 'xlsx', 'xls'].includes(ext ?? '')) {
    return NextResponse.json({ error: 'Unsupported file type. Upload a CSV or Excel file.' }, { status: 400 })
  }

  // Parse workbook
  const buffer = Buffer.from(await file.arrayBuffer())
  let rows: Record<string, unknown>[]
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  } catch {
    return NextResponse.json({ error: 'Could not parse file. Make sure it is a valid CSV or Excel spreadsheet.' }, { status: 400 })
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'The spreadsheet is empty.' }, { status: 400 })
  }

  // Map raw header keys → normalised names
  const rawKeys = Object.keys(rows[0])
  const headerMap: Record<string, string> = {}
  for (const k of rawKeys) {
    headerMap[normaliseHeader(k)] = k
  }

  const descKey   = headerMap['description'] ?? headerMap['desc'] ?? headerMap['productdescription'] ?? headerMap['name']
  const skuKey    = headerMap['sku'] ?? headerMap['productsku'] ?? headerMap['itemsku']
  const serialKey = headerMap['serializable'] ?? headerMap['isserialisable'] ?? headerMap['isserializable'] ?? headerMap['serial']

  const missing: string[] = []
  if (!descKey)   missing.push('description')
  if (!skuKey)    missing.push('sku')
  if (!serialKey) missing.push('serializable')

  if (missing.length) {
    return NextResponse.json({
      error: `Missing required column(s): ${missing.join(', ')}. ` +
        'Expected columns: description, sku, serializable.',
    }, { status: 400 })
  }

  let created = 0
  let skipped = 0
  let existing = 0
  const errors: RowError[] = []
  const existingSkus: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2 // +2: 1-indexed + header row
    const raw    = rows[i]

    const description   = String(raw[descKey]   ?? '').trim()
    const sku           = String(raw[skuKey]     ?? '').trim().toUpperCase()
    const isSerializable = parseBool(raw[serialKey])

    if (!description) {
      errors.push({ row: rowNum, sku: sku || '(blank)', reason: 'description is required' })
      skipped++
      continue
    }
    if (!sku) {
      errors.push({ row: rowNum, sku: '(blank)', reason: 'sku is required' })
      skipped++
      continue
    }
    if (isSerializable === null) {
      errors.push({ row: rowNum, sku, reason: `"${raw[serialKey]}" is not a valid value for serializable (use yes/no)` })
      skipped++
      continue
    }

    try {
      // Skip if SKU already exists
      const exists = await prisma.product.findUnique({ where: { sku }, select: { id: true } })
      if (exists) {
        existing++
        existingSkus.push(sku)
        continue
      }

      await prisma.product.create({
        data: { description, sku, isSerializable },
      })
      created++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      errors.push({ row: rowNum, sku, reason: msg })
      skipped++
    }
  }

  return NextResponse.json({ created, skipped, existing, existingSkus, errors })
}
