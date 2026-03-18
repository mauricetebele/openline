/**
 * POST /api/inventory/migrate?mode=parse  — validate spreadsheet, return staging data
 * POST /api/inventory/migrate?mode=commit — import validated rows into inventory
 */
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

// ─── Header normalisation ────────────────────────────────────────────────────

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_\-#]+/g, '')
}

const VENDOR_ALIASES  = ['vendorid', 'vid', 'vendor']
const COST_ALIASES    = ['cost', 'unitcost', 'price']
const SKU_ALIASES     = ['sku', 'productsku', 'itemsku']
const GRADE_ALIASES   = ['grade', 'condition']
const SERIAL_ALIASES  = ['serial', 'serialnumber', 'sn', 'serial#', 'serialno']

function findKey(headerMap: Record<string, string>, aliases: string[]): string | undefined {
  for (const a of aliases) {
    // strip # from alias too for matching
    const normalised = norm(a)
    if (headerMap[normalised]) return headerMap[normalised]
  }
  return undefined
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParsedRow {
  rowNum: number
  valid: boolean
  vendorNumber: number | null
  vendorId: string | null
  vendorName: string | null
  cost: number | null
  sku: string
  grade: string
  serial: string
  error: string | null
  isNewProduct: boolean
  isNewGrade: boolean
}

interface ParseSummary {
  totalRows: number
  validRows: number
  errorRows: number
  newProducts: string[]
  newGrades: string[]
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mode = req.nextUrl.searchParams.get('mode')
  if (mode === 'parse') return handleParse(req)
  if (mode === 'commit') return handleCommit(req, user.dbId)
  return NextResponse.json({ error: 'Invalid mode — use ?mode=parse or ?mode=commit' }, { status: 400 })
}

// ─── Parse Mode ──────────────────────────────────────────────────────────────

async function handleParse(req: NextRequest) {
  let formData: FormData
  try { formData = await req.formData() } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const locationId = formData.get('locationId') as string | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  if (!locationId) return NextResponse.json({ error: 'Location is required' }, { status: 400 })

  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!['csv', 'xlsx', 'xls'].includes(ext ?? '')) {
    return NextResponse.json({ error: 'Unsupported file type. Upload a CSV or Excel file.' }, { status: 400 })
  }

  // Verify location exists
  const location = await prisma.location.findUnique({ where: { id: locationId } })
  if (!location) return NextResponse.json({ error: 'Location not found' }, { status: 404 })

  // Parse workbook
  const buffer = Buffer.from(await file.arrayBuffer())
  let rawRows: Record<string, unknown>[]
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  } catch {
    return NextResponse.json({ error: 'Could not parse file.' }, { status: 400 })
  }

  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'The spreadsheet is empty.' }, { status: 400 })
  }

  // Map headers
  const rawKeys = Object.keys(rawRows[0])
  const headerMap: Record<string, string> = {}
  for (const k of rawKeys) headerMap[norm(k)] = k

  const vendorKey = findKey(headerMap, VENDOR_ALIASES)
  const costKey   = findKey(headerMap, COST_ALIASES)
  const skuKey    = findKey(headerMap, SKU_ALIASES)
  const gradeKey  = findKey(headerMap, GRADE_ALIASES)
  const serialKey = findKey(headerMap, SERIAL_ALIASES)

  const missing: string[] = []
  if (!vendorKey) missing.push('Vendor ID')
  if (!skuKey)    missing.push('SKU')
  if (!serialKey) missing.push('Serial #')
  if (missing.length) {
    return NextResponse.json({
      error: `Missing required column(s): ${missing.join(', ')}. Expected: Vendor ID, Cost, SKU, Grade, Serial #`,
    }, { status: 400 })
  }

  // Batch-fetch all vendors, products, grades, and existing serials
  const allVendors = await prisma.vendor.findMany({ select: { id: true, vendorNumber: true, name: true } })
  const vendorByNum = new Map(allVendors.map(v => [v.vendorNumber, v]))

  const allProducts = await prisma.product.findMany({ select: { id: true, sku: true } })
  const productBySku = new Map(allProducts.map(p => [p.sku.toUpperCase(), p]))

  const allGrades = await prisma.grade.findMany({ select: { id: true, grade: true } })
  const gradeMap = new Map<string, { id: string }>()
  for (const g of allGrades) gradeMap.set(g.grade.toUpperCase(), g)

  // Collect all serials from file for batch DB check
  const fileSerials: string[] = []
  for (const row of rawRows) {
    const sn = String(row[serialKey!] ?? '').trim()
    if (sn) fileSerials.push(sn)
  }

  const existingSerials = fileSerials.length > 0
    ? await prisma.inventorySerial.findMany({
        where: { serialNumber: { in: fileSerials, mode: 'insensitive' }, status: 'IN_STOCK' },
        select: { serialNumber: true, product: { select: { sku: true } } },
      })
    : []
  const inStockSet = new Set(existingSerials.map(s => s.serialNumber.toUpperCase()))
  const inStockSkuMap = new Map(existingSerials.map(s => [s.serialNumber.toUpperCase(), s.product.sku]))

  // Parse rows
  const rows: ParsedRow[] = []
  const dupTracker = new Map<string, number>() // "SKU::SERIAL" → rowNum
  const newProductSet = new Set<string>()
  const newGradeSet = new Set<string>()

  for (let i = 0; i < rawRows.length; i++) {
    const rowNum = i + 2 // 1-indexed + header
    const raw = rawRows[i]

    const vendorRaw = String(raw[vendorKey!] ?? '').trim()
    const costRaw   = costKey ? String(raw[costKey] ?? '').trim() : ''
    const skuRaw    = String(raw[skuKey!] ?? '').trim().toUpperCase()
    const gradeRaw  = gradeKey ? String(raw[gradeKey] ?? '').trim().toUpperCase() : ''
    const serialRaw = String(raw[serialKey!] ?? '').trim()

    const row: ParsedRow = {
      rowNum, valid: true, vendorNumber: null, vendorId: null, vendorName: null,
      cost: null, sku: skuRaw, grade: gradeRaw, serial: serialRaw,
      error: null, isNewProduct: false, isNewGrade: false,
    }

    const errors: string[] = []

    // Vendor ID validation
    if (!vendorRaw) {
      errors.push('Vendor ID is required')
    } else if (!/^\d+$/.test(vendorRaw)) {
      errors.push('Vendor ID must be a number')
    } else {
      const vNum = parseInt(vendorRaw, 10)
      const vendor = vendorByNum.get(vNum)
      if (!vendor) {
        errors.push(`Unknown vendor V-${vNum}`)
      } else {
        row.vendorNumber = vNum
        row.vendorId = vendor.id
        row.vendorName = vendor.name
      }
    }

    // SKU validation
    if (!skuRaw) errors.push('SKU is required')

    // Serial validation
    if (!serialRaw) {
      errors.push('Serial # is required')
    } else {
      // Duplicate within file
      const dupKey = `${skuRaw}::${serialRaw.toUpperCase()}`
      const prevRow = dupTracker.get(dupKey)
      if (prevRow) {
        errors.push(`Duplicate serial (same as row ${prevRow})`)
      } else {
        dupTracker.set(dupKey, rowNum)
      }

      // Already in stock in DB
      if (inStockSet.has(serialRaw.toUpperCase())) {
        const existingSku = inStockSkuMap.get(serialRaw.toUpperCase())
        errors.push(`Serial already in stock${existingSku ? ` (${existingSku})` : ''}`)
      }
    }

    // Cost validation
    if (costRaw) {
      const costVal = parseFloat(costRaw.replace(/[$,]/g, ''))
      if (isNaN(costVal) || costVal < 0) {
        errors.push('Invalid cost')
      } else {
        row.cost = costVal
      }
    }

    // Check if product exists → mark new
    if (skuRaw && !productBySku.has(skuRaw)) {
      row.isNewProduct = true
      newProductSet.add(skuRaw)
    }

    // Check if grade exists → mark new (grades are global now)
    if (gradeRaw && !gradeMap.has(gradeRaw)) {
      row.isNewGrade = true
      newGradeSet.add(gradeRaw)
    }

    if (errors.length) {
      row.valid = false
      row.error = errors.join('; ')
    }

    rows.push(row)
  }

  const summary: ParseSummary = {
    totalRows: rows.length,
    validRows: rows.filter(r => r.valid).length,
    errorRows: rows.filter(r => !r.valid).length,
    newProducts: Array.from(newProductSet),
    newGrades: Array.from(newGradeSet),
  }

  return NextResponse.json({ rows, summary })
}

// ─── Commit Mode ─────────────────────────────────────────────────────────────

interface CommitRow {
  vendorNumber: number
  vendorId: string
  vendorName: string | null
  cost: number | null
  sku: string
  grade: string
  serial: string
}

async function handleCommit(req: NextRequest, userId: string) {
  let body: { locationId: string; rows: CommitRow[] }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { locationId, rows } = body
  if (!locationId || !rows?.length) {
    return NextResponse.json({ error: 'locationId and rows are required' }, { status: 400 })
  }

  // Verify location
  const location = await prisma.location.findUnique({ where: { id: locationId } })
  if (!location) return NextResponse.json({ error: 'Location not found' }, { status: 404 })

  let imported = 0
  let productsCreated = 0
  let gradesCreated = 0

  try {
    await prisma.$transaction(async (tx) => {
      // Resolve/create products and grades
      const productCache = new Map<string, string>() // SKU → id
      const gradeCache = new Map<string, string>()   // "GRADE" → gradeId

      // Pre-fetch existing products
      const existingProducts = await tx.product.findMany({
        where: { sku: { in: rows.map(r => r.sku) } },
        select: { id: true, sku: true },
      })
      for (const p of existingProducts) productCache.set(p.sku.toUpperCase(), p.id)

      // Pre-fetch existing grades (global)
      const existingGrades = await tx.grade.findMany({
        select: { id: true, grade: true },
      })
      for (const g of existingGrades) gradeCache.set(g.grade.toUpperCase(), g.id)

      // Pre-fetch vendors by vendorNumber
      const vendorNums = Array.from(new Set(rows.map(r => r.vendorNumber)))
      const vendors = await tx.vendor.findMany({
        where: { vendorNumber: { in: vendorNums } },
        select: { id: true, vendorNumber: true, name: true },
      })
      const vendorByNum = new Map(vendors.map(v => [v.vendorNumber, v]))

      // Qty accumulator for InventoryItem upserts: "productId::gradeId|null" → qty
      const qtyAccum = new Map<string, { productId: string; gradeId: string | null; qty: number }>()

      for (const row of rows) {
        // Resolve vendor
        const vendor = vendorByNum.get(row.vendorNumber)
        if (!vendor) throw new Error(`Vendor V-${row.vendorNumber} not found`)

        // Resolve or create product
        let productId = productCache.get(row.sku.toUpperCase())
        if (!productId) {
          const newProduct = await tx.product.create({
            data: { sku: row.sku.toUpperCase(), description: row.sku, isSerializable: true },
          })
          productId = newProduct.id
          productCache.set(row.sku.toUpperCase(), productId)
          productsCreated++
        }

        // Resolve or create grade (global)
        let gradeId: string | null = null
        if (row.grade) {
          const gKey = row.grade.toUpperCase()
          gradeId = gradeCache.get(gKey) ?? null
          if (!gradeId) {
            const newGrade = await tx.grade.create({
              data: { grade: gKey },
            })
            gradeId = newGrade.id
            gradeCache.set(gKey, gradeId)
            gradesCreated++
          }
        }

        // Create InventorySerial
        const serial = await tx.inventorySerial.create({
          data: {
            serialNumber: row.serial.trim(),
            productId,
            locationId,
            gradeId,
            status: 'IN_STOCK',
          },
        })

        // Create SerialHistory
        const costNote = row.cost != null ? ` | Cost: $${row.cost.toFixed(2)}` : ''
        await tx.serialHistory.create({
          data: {
            inventorySerialId: serial.id,
            eventType: 'MIGRATION',
            locationId,
            userId,
            notes: `Migration import — Vendor: ${vendor.name} (V-${vendor.vendorNumber})${costNote}`,
          },
        })

        // Accumulate qty
        const qKey = `${productId}::${gradeId ?? 'NULL'}`
        const existing = qtyAccum.get(qKey)
        if (existing) {
          existing.qty++
        } else {
          qtyAccum.set(qKey, { productId, gradeId, qty: 1 })
        }

        imported++
      }

      // Upsert InventoryItem quantities
      for (const { productId, gradeId, qty } of Array.from(qtyAccum.values())) {
        if (gradeId) {
          await tx.inventoryItem.upsert({
            where: { productId_locationId_gradeId: { productId, locationId, gradeId } },
            create: { productId, locationId, gradeId, qty },
            update: { qty: { increment: qty } },
          })
        } else {
          // Null-grade workaround (Prisma composite unique doesn't support null)
          const existingItem = await tx.inventoryItem.findFirst({
            where: { productId, locationId, gradeId: null },
          })
          if (existingItem) {
            await tx.inventoryItem.update({
              where: { id: existingItem.id },
              data: { qty: { increment: qty } },
            })
          } else {
            await tx.inventoryItem.create({
              data: { productId, locationId, gradeId: null, qty },
            })
          }
        }
      }
    }, { timeout: 60000 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[migrate/commit] Transaction error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ success: true, imported, productsCreated, gradesCreated })
}
