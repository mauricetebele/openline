/**
 * POST /api/listings/bulk-upload
 * Accepts multipart/form-data with `file` (CSV/XLSX) and `accountId`.
 * Parses and validates rows against DB — does NOT create listings.
 * Returns: { rows: ParsedRow[], summary: { total, valid, errors } }
 */
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const ASIN_RE = /^B0[A-Z0-9]{8}$/

const VALID_CONDITIONS = [
  'New',
  'Used - Like New',
  'Used - Very Good',
  'Used - Good',
  'Used - Acceptable',
  'Refurbished',
]

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

export interface ParsedRow {
  rowNum: number
  sku: string
  grade: string
  sellerSku: string
  asin: string
  price: number | null
  condition: string
  quantity: number
  shippingTemplate: string
  productId: string | null
  gradeId: string | null
  gradeName: string | null
  description: string | null
  errors: string[]
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const adminErr = requireAdmin(user)
    if (adminErr) return adminErr

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let formData: any
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
    let rawRows: Record<string, unknown>[]
    try {
      const wb = XLSX.read(buffer, { type: 'buffer' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    } catch {
      return NextResponse.json({ error: 'Could not parse file. Make sure it is a valid CSV or Excel spreadsheet.' }, { status: 400 })
    }

    if (rawRows.length === 0) {
      return NextResponse.json({ error: 'The spreadsheet is empty.' }, { status: 400 })
    }

    // Map raw header keys to normalised names
    const rawKeys = Object.keys(rawRows[0])
    const headerMap: Record<string, string> = {}
    for (const k of rawKeys) {
      headerMap[normaliseHeader(k)] = k
    }

    const skuKey = headerMap['sku'] ?? headerMap['productsku'] ?? headerMap['internalsku']
    const gradeKey = headerMap['grade'] ?? headerMap['gradename']
    const sellerSkuKey = headerMap['sellersku'] ?? headerMap['marketplacesku'] ?? headerMap['msku'] ?? headerMap['amazonsku']
    const asinKey = headerMap['asin']
    const priceKey = headerMap['price']
    const conditionKey = headerMap['condition']
    const quantityKey = headerMap['quantity'] ?? headerMap['qty']
    const templateKey = headerMap['shippingtemplate'] ?? headerMap['template']

    // Check required columns
    const missing: string[] = []
    if (!skuKey) missing.push('SKU')
    if (!asinKey) missing.push('ASIN')
    if (!priceKey) missing.push('Price')

    if (missing.length) {
      return NextResponse.json({
        error: `Missing required column(s): ${missing.join(', ')}. Expected: SKU, ASIN, Price.`,
      }, { status: 400 })
    }

    // Collect all unique SKUs and grades for batch lookup
    const allSkus = new Set<string>()
    const allGrades = new Set<string>()
    for (const raw of rawRows) {
      const sku = String(raw[skuKey!] ?? '').trim().toUpperCase()
      if (sku) allSkus.add(sku)
      if (gradeKey) {
        const grade = String(raw[gradeKey] ?? '').trim()
        if (grade) allGrades.add(grade)
      }
    }

    // Batch fetch products and grades
    const products = await prisma.product.findMany({
      where: { sku: { in: Array.from(allSkus) } },
      select: { id: true, sku: true, description: true },
    })
    const productMap = new Map(products.map(p => [p.sku, p]))

    const grades = allGrades.size > 0
      ? await prisma.grade.findMany({
          where: { grade: { in: Array.from(allGrades), mode: 'insensitive' } },
          select: { id: true, grade: true },
        })
      : []
    const gradeMap = new Map(grades.map(g => [g.grade.toLowerCase(), g]))

    // Track duplicate seller SKUs within the file
    const sellerSkuCounts = new Map<string, number>()
    if (sellerSkuKey) {
      for (const raw of rawRows) {
        const ss = String(raw[sellerSkuKey] ?? '').trim()
        if (ss) sellerSkuCounts.set(ss, (sellerSkuCounts.get(ss) ?? 0) + 1)
      }
    }

    // Validate each row
    const rows: ParsedRow[] = []

    for (let i = 0; i < rawRows.length; i++) {
      const rowNum = i + 2 // 1-indexed + header row
      const raw = rawRows[i]
      const errors: string[] = []

      const sku = String(raw[skuKey!] ?? '').trim().toUpperCase()
      const grade = gradeKey ? String(raw[gradeKey] ?? '').trim() : ''
      const sellerSku = sellerSkuKey ? String(raw[sellerSkuKey] ?? '').trim() : ''
      const asin = String(raw[asinKey!] ?? '').trim().toUpperCase()
      const priceRaw = String(raw[priceKey!] ?? '').trim()
      const condition = conditionKey ? String(raw[conditionKey] ?? '').trim() : 'New'
      const quantityRaw = quantityKey ? String(raw[quantityKey] ?? '').trim() : '0'
      const shippingTemplate = templateKey ? String(raw[templateKey] ?? '').trim() : ''

      // Validate SKU exists
      let productId: string | null = null
      let description: string | null = null
      if (!sku) {
        errors.push('SKU is required')
      } else {
        const product = productMap.get(sku)
        if (!product) {
          errors.push(`Product "${sku}" not found`)
        } else {
          productId = product.id
          description = product.description
        }
      }

      // Validate grade
      let gradeId: string | null = null
      let gradeName: string | null = null
      if (grade) {
        const g = gradeMap.get(grade.toLowerCase())
        if (!g) {
          errors.push(`Grade "${grade}" not found`)
        } else {
          gradeId = g.id
          gradeName = g.grade
        }
      }

      // Validate seller SKU (optional — auto-generated if blank)
      if (sellerSku && (sellerSkuCounts.get(sellerSku) ?? 0) > 1) {
        errors.push('Duplicate Seller SKU in file')
      }

      // Validate ASIN
      if (!asin) {
        errors.push('ASIN is required')
      } else if (!ASIN_RE.test(asin)) {
        errors.push(`Invalid ASIN format "${asin}"`)
      }

      // Validate price
      const price = parseFloat(priceRaw)
      if (!priceRaw || isNaN(price)) {
        errors.push('Price is required and must be a number')
      } else if (price <= 0) {
        errors.push('Price must be > 0')
      }

      // Validate condition
      const matchedCondition = VALID_CONDITIONS.find(c => c.toLowerCase() === condition.toLowerCase()) ?? ''
      if (condition && !matchedCondition) {
        errors.push(`Invalid condition "${condition}". Valid: ${VALID_CONDITIONS.join(', ')}`)
      }

      // Validate quantity
      const quantity = parseInt(quantityRaw, 10)
      if (quantityRaw && (isNaN(quantity) || quantity < 0)) {
        errors.push('Quantity must be a non-negative integer')
      }

      rows.push({
        rowNum,
        sku,
        grade,
        sellerSku,
        asin,
        price: isNaN(price) ? null : price,
        condition: matchedCondition || condition || 'New',
        quantity: isNaN(quantity) || quantity < 0 ? 0 : quantity,
        shippingTemplate,
        productId,
        gradeId,
        gradeName,
        description,
        errors,
      })
    }

    const validCount = rows.filter(r => r.errors.length === 0).length
    const errorCount = rows.filter(r => r.errors.length > 0).length

    return NextResponse.json({
      rows,
      summary: { total: rows.length, valid: validCount, errors: errorCount },
    })
  } catch (err) {
    console.error('[POST /api/listings/bulk-upload] Unhandled error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
