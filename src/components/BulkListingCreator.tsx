'use client'
import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import {
  AlertCircle, CheckCircle2, XCircle, Loader2, ChevronRight, ArrowLeft, X, Plus, Trash2,
  Upload, FileSpreadsheet, Download,
} from 'lucide-react'
import { clsx } from 'clsx'
import { AmazonAccountDTO } from '@/types'

// ─── Constants ───────────────────────────────────────────────────────────────

const ASIN_RE = /^B0[A-Z0-9]{8}$/

/** Auto-generate a random seller SKU like Amazon does (e.g. XX-HKQM-BRTZ) */
function generateSellerSku(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const seg = (len: number) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `${seg(2)}-${seg(4)}-${seg(4)}`
}

const CONDITIONS = [
  'New',
  'Used - Like New',
  'Used - Very Good',
  'Used - Good',
  'Used - Acceptable',
  'Refurbished',
]

const BM_CONDITIONS = ['Excellent', 'Good', 'Stallone']

// ─── Types ───────────────────────────────────────────────────────────────────

interface LookupProduct {
  product: { id: string; sku: string; description: string }
  grades: { gradeId: string | null; gradeName: string | null; availableQty: number }[]
}

interface StagingRow {
  productId: string
  internalSku: string
  description: string
  gradeId: string | null
  gradeName: string | null
  availableQty: number
  checked: boolean
}

interface GradeOption {
  id: string
  grade: string
}

interface ListingRow {
  productId: string
  internalSku: string
  description: string
  gradeId: string | null
  gradeName: string | null
  availableQty: number
  marketplaceSku: string
  asin: string
  price: string
  condition: string
  quantity: string
  shippingTemplate: string
}

type RowStatus = 'pending' | 'creating' | 'success' | 'error'

interface ProgressRow extends ListingRow {
  status: RowStatus
  error?: string
}

// ─── Upload Types ─────────────────────────────────────────────────────────

interface UploadParsedRow {
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

interface UploadProgressRow extends UploadParsedRow {
  status: RowStatus
  error?: string
}

const TEMPLATE_CSV = `SKU,Grade,Seller SKU,ASIN,Price,Condition,Quantity,Shipping Template
IPHONE-15-128,A,IP15-128-AMZ-A,B0XXXXXXXXX,299.99,Used - Like New,1,US Standard
IPHONE-14-256,,,B0YYYYYYYYY,199.99,New,5,`

// ─── Component ───────────────────────────────────────────────────────────────

export default function BulkListingCreator() {
  // Mode toggle
  const [mode, setMode] = useState<'manual' | 'upload'>('manual')
  const [marketplace, setMarketplace] = useState<'amazon' | 'backmarket'>('amazon')
  const isBM = marketplace === 'backmarket'

  // Step: 0=page textarea, 1=staging, 2=form, 3=progress
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0)

  // Step 0 — raw input
  const [rawText, setRawText] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)

  // Upload flow state
  const [uploadStep, setUploadStep] = useState<'upload' | 'review' | 'progress'>('upload')
  const [uploadParsedRows, setUploadParsedRows] = useState<UploadParsedRow[]>([])
  const [uploadSummary, setUploadSummary] = useState<{ total: number; valid: number; errors: number } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadProgressRows, setUploadProgressRows] = useState<UploadProgressRow[]>([])
  const [uploadIsCreating, setUploadIsCreating] = useState(false)
  const uploadCreatingRef = useRef(false)
  const [uploadAccountId, setUploadAccountId] = useState('')
  const [uploadFulfillment, setUploadFulfillment] = useState<'MFN' | 'FBA'>('MFN')
  const [dragging, setDragging] = useState(false)

  // Step 1 — staging
  const [stagingRows, setStagingRows] = useState<StagingRow[]>([])
  const [notFoundSkus, setNotFoundSkus] = useState<string[]>([])

  // Step 2 — listing details
  const [listingRows, setListingRows] = useState<ListingRow[]>([])
  const [accounts, setAccounts] = useState<AmazonAccountDTO[]>([])
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<string[]>([])
  const [accountId, setAccountId] = useState('')
  const [fulfillment, setFulfillment] = useState<'MFN' | 'FBA'>('MFN')
  const [allGrades, setAllGrades] = useState<GradeOption[]>([])
  const [asinSuggestions, setAsinSuggestions] = useState<Record<string, string>>({})
  const [buyBoxData, setBuyBoxData] = useState<Record<string, { price: number | null; seller: string | null; isFba: boolean; loading: boolean }>>({})

  // Locked rows (successfully created — not editable on retry)
  const [lockedKeys, setLockedKeys] = useState<Set<string>>(new Set())

  // Step 3 — progress
  const [progressRows, setProgressRows] = useState<ProgressRow[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const creatingRef = useRef(false)

  // ─── Fetch buy box data when ASIN is populated ──────────────────────────

  const fetchBuyBox = useCallback(async (asin: string) => {
    if (!ASIN_RE.test(asin) || !accountId || buyBoxData[asin]?.price !== undefined) return
    setBuyBoxData(prev => ({ ...prev, [asin]: { price: null, seller: null, isFba: false, loading: true } }))
    try {
      const res = await fetch(`/api/pricing/buybox?accountId=${accountId}&asin=${asin}`)
      if (!res.ok) return
      const data = await res.json()
      setBuyBoxData(prev => ({ ...prev, [asin]: { price: data.buyBoxPrice, seller: data.sellerName, isFba: data.isFba ?? false, loading: false } }))
    } catch {
      setBuyBoxData(prev => ({ ...prev, [asin]: { price: null, seller: null, isFba: false, loading: false } }))
    }
  }, [accountId, buyBoxData])

  // ─── Load accounts + grades on mount ────────────────────────────────────

  useEffect(() => {
    fetch('/api/accounts')
      .then(async (r) => {
        if (!r.ok) {
          const json = await r.json().catch(() => ({}))
          throw new Error(json.error ?? `${r.status} ${r.statusText}`)
        }
        return r.json()
      })
      .then((data: AmazonAccountDTO[]) => {
        if (!Array.isArray(data) || data.length === 0) {
          setAccountsError('No Amazon accounts connected.')
          return
        }
        setAccounts(data)
        setAccountId(data[0].id)
        setUploadAccountId(data[0].id)
      })
      .catch((err) => setAccountsError(err.message))

    fetch('/api/grades')
      .then(r => r.json())
      .then(j => setAllGrades((j.data ?? []).map((g: { id: string; grade: string }) => ({ id: g.id, grade: g.grade }))))
      .catch(() => {})
  }, [])

  // Load templates when account changes
  useEffect(() => {
    if (!accountId) return
    fetch(`/api/listings?accountId=${accountId}&pageSize=1`)
      .then((r) => r.json())
      .then((data) => { if (data.templates) setTemplates(data.templates) })
      .catch(() => {})
  }, [accountId])

  // ─── Step 0 → Step 1: Load SKUs ─────────────────────────────────────────

  const handleLoadSkus = useCallback(async () => {
    const lines = rawText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
    const uniqueSkus = Array.from(new Set(lines))

    if (uniqueSkus.length === 0) return

    setLookupLoading(true)
    setLookupError(null)

    try {
      const res = await fetch('/api/products/lookup-skus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus: uniqueSkus }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Lookup failed')

      const found: LookupProduct[] = data.found
      const notFound: string[] = data.notFound

      // Expand into staging rows
      const rows: StagingRow[] = []
      for (const item of found) {
        const { product, grades } = item
        if (grades.length === 0) {
          // Product exists but no inventory — show grayed out
          rows.push({
            productId: product.id,
            internalSku: product.sku,
            description: product.description,
            gradeId: null,
            gradeName: null,
            availableQty: 0,
            checked: false,
          })
        } else {
          for (const g of grades) {
            rows.push({
              productId: product.id,
              internalSku: product.sku,
              description: product.description,
              gradeId: g.gradeId,
              gradeName: g.gradeName,
              availableQty: g.availableQty,
              checked: g.availableQty > 0,
            })
          }
        }
      }

      setStagingRows(rows)
      setNotFoundSkus(notFound)
      setStep(1)
    } catch (err: unknown) {
      setLookupError(err instanceof Error ? err.message : String(err))
    } finally {
      setLookupLoading(false)
    }
  }, [rawText])

  // ─── Step 1 → Step 2: Move to form ──────────────────────────────────────

  const handleNextToForm = useCallback(async () => {
    const checked = stagingRows.filter(r => r.checked)

    let suggestions: Record<string, string> = {}
    if (!isBM) {
      // Fetch ASIN suggestions for selected products (Amazon only)
      const uniqueProductIds = Array.from(new Set(checked.map(r => r.productId)))
      try {
        const res = await fetch(`/api/marketplace-skus/asin-suggestions?productIds=${uniqueProductIds.join(',')}`)
        const data = await res.json()
        if (res.ok && data.data) suggestions = data.data
      } catch { /* ignore — suggestions are optional */ }
      setAsinSuggestions(suggestions)
    }

    const rows: ListingRow[] = checked.map(r => ({
      productId: r.productId,
      internalSku: r.internalSku,
      description: r.description,
      gradeId: r.gradeId,
      gradeName: r.gradeName,
      availableQty: r.availableQty,
      marketplaceSku: '',
      asin: isBM ? '' : (suggestions[r.productId] ?? ''),
      price: '',
      condition: isBM ? BM_CONDITIONS[0] : 'New',
      quantity: isBM ? '1' : '0',
      shippingTemplate: '',
    }))
    setListingRows(rows)
    if (!isBM) {
      // Fetch buy box data for any auto-populated ASINs
      for (const r of rows) {
        if (ASIN_RE.test(r.asin)) fetchBuyBox(r.asin)
      }
    }
    setStep(2)
  }, [stagingRows, fetchBuyBox, isBM])

  // ─── Step 2 validation ──────────────────────────────────────────────────

  const getRowErrors = (row: ListingRow, index: number): string[] => {
    const errs: string[] = []
    if (isBM) {
      if (!row.asin.trim() || !/^\d+$/.test(row.asin.trim())) errs.push('BMID must be numeric')
      if (!BM_CONDITIONS.includes(row.condition)) errs.push('Invalid BM condition')
      const p = parseFloat(row.price)
      if (!row.price || isNaN(p) || p <= 0) errs.push('Price > 0')
    } else {
      if (!ASIN_RE.test(row.asin)) errs.push('Invalid ASIN')
      const p = parseFloat(row.price)
      if (!row.price || isNaN(p) || p <= 0) errs.push('Price > 0')
    }
    // Check for duplicate product+grade within the list
    const isDupe = listingRows.some((other, j) =>
      j !== index && other.productId === row.productId && other.gradeId === row.gradeId
    )
    if (isDupe) errs.push('Duplicate SKU+Grade')
    return errs
  }

  const editableRows = listingRows.filter(r => !lockedKeys.has(`${r.productId}::${r.gradeId}::${r.marketplaceSku}`))
  const validListingRows = editableRows.filter((r, i) => getRowErrors(r, listingRows.indexOf(r)).length === 0)
  const errorListingRows = editableRows.filter((r, i) => getRowErrors(r, listingRows.indexOf(r)).length > 0)

  // ─── Step 2 → Step 3: Submit ─────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    const rows: ProgressRow[] = validListingRows.map(r => ({
      ...r,
      marketplaceSku: r.marketplaceSku.trim() || generateSellerSku(),
      status: 'pending' as RowStatus,
    }))
    setProgressRows(rows)
    setIsCreating(true)
    setStep(3)
  }, [validListingRows])

  // ─── Step 3 → Step 2: Back to edit (retry failed rows) ─────────────────

  const handleBackToEdit = useCallback(() => {
    // Lock successfully created rows
    const newLocked = new Set(lockedKeys)
    const remaining: ListingRow[] = []

    for (const row of progressRows) {
      const key = `${row.productId}::${row.gradeId}::${row.marketplaceSku}`
      if (row.status === 'success') {
        newLocked.add(key)
        // Keep as locked listing row
        remaining.push({
          productId: row.productId,
          internalSku: row.internalSku,
          description: row.description,
          gradeId: row.gradeId,
          gradeName: row.gradeName,
          availableQty: row.availableQty,
          marketplaceSku: row.marketplaceSku,
          asin: row.asin,
          price: row.price,
          condition: row.condition,
          quantity: row.quantity,
          shippingTemplate: row.shippingTemplate,
        })
      } else {
        // Failed/pending rows stay editable
        remaining.push({
          productId: row.productId,
          internalSku: row.internalSku,
          description: row.description,
          gradeId: row.gradeId,
          gradeName: row.gradeName,
          availableQty: row.availableQty,
          marketplaceSku: row.marketplaceSku,
          asin: row.asin,
          price: row.price,
          condition: row.condition,
          quantity: row.quantity,
          shippingTemplate: row.shippingTemplate,
        })
      }
    }

    setLockedKeys(newLocked)
    setListingRows(remaining)
    setProgressRows([])
    setStep(2)
  }, [progressRows, lockedKeys])

  // ─── Step 3: Sequential creation ─────────────────────────────────────────

  useEffect(() => {
    if (!isCreating || creatingRef.current) return
    creatingRef.current = true

    const templateCache = new Map<string, string>()

    async function createAll() {
      const rows = [...progressRows]

      if (isBM) {
        // BackMarket: single batch call
        setProgressRows(prev => prev.map(r => ({ ...r, status: 'creating' })))
        try {
          const payload = {
            rows: rows.map(r => ({
              productId: r.productId,
              gradeId: r.gradeId,
              sellerSku: r.marketplaceSku.trim(),
              bmId: r.asin.trim(),
              condition: r.condition,
              price: parseFloat(r.price),
            })),
          }
          const res = await fetch('/api/marketplace-skus/bulk-backmarket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

          const resultMap = new Map<string, { status: string; error?: string }>()
          for (const r of data.results ?? []) {
            resultMap.set(r.sellerSku, r)
          }
          setProgressRows(prev => prev.map(r => {
            const result = resultMap.get(r.marketplaceSku.trim())
            if (result?.status === 'success') return { ...r, status: 'success' as RowStatus }
            return { ...r, status: 'error' as RowStatus, error: result?.error ?? 'Unknown error' }
          }))
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          setProgressRows(prev => prev.map(r => ({ ...r, status: 'error' as RowStatus, error: msg })))
        }

        setIsCreating(false)
        creatingRef.current = false
        return
      }

      // Amazon: sequential per-row creation
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]

        // Update status to 'creating'
        setProgressRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'creating' } : r))

        try {
          const qtyNum = fulfillment === 'FBA' ? 0 : (parseInt(row.quantity, 10) || 0)
          const body: Record<string, unknown> = {
            accountId,
            sku: row.marketplaceSku.trim(),
            asin: row.asin,
            price: parseFloat(row.price),
            condition: row.condition,
            fulfillmentChannel: fulfillment,
            quantity: qtyNum,
            productId: row.productId,
            gradeId: row.gradeId,
          }
          if (fulfillment === 'MFN' && row.shippingTemplate) {
            const cached = templateCache.get(row.shippingTemplate)
            if (cached) {
              body.shippingTemplateGroupId = cached
            } else {
              body.shippingTemplate = row.shippingTemplate
            }
          }

          const res = await fetch('/api/listings/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          let data: Record<string, unknown>
          try { data = await res.json() } catch { data = { error: `HTTP ${res.status}: ${res.statusText}` } }
          if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`)

          // Cache the resolved template group ID for subsequent calls with the same template
          if (data.shippingTemplateGroupId && row.shippingTemplate && !templateCache.has(row.shippingTemplate)) {
            templateCache.set(row.shippingTemplate, data.shippingTemplateGroupId as string)
          }

          setProgressRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'success' } : r))

          // Fire-and-forget FNSKU fetch for FBA listings
          if (fulfillment === 'FBA') {
            fetch(`/api/fba-shipments/fetch-fnsku?accountId=${accountId}&sellerSku=${encodeURIComponent(row.marketplaceSku.trim())}`).catch(() => {})
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          setProgressRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: msg } : r))
        }

        // Rate-limit delay between calls
        if (i < rows.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 400))
        }
      }

      setIsCreating(false)
      creatingRef.current = false
    }

    createAll()
  }, [isCreating]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Computed ────────────────────────────────────────────────────────────

  const succeededCount = progressRows.filter(r => r.status === 'success').length
  const failedCount = progressRows.filter(r => r.status === 'error').length
  const checkedCount = stagingRows.filter(r => r.checked).length

  // ─── Upload: file handler ───────────────────────────────────────────────

  const handleUploadFile = useCallback(async (file: File) => {
    if (!uploadAccountId) {
      setUploadError('Please select an account first.')
      return
    }

    setUploadLoading(true)
    setUploadError(null)

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('accountId', uploadAccountId)

      const res = await fetch('/api/listings/bulk-upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')

      setUploadParsedRows(data.rows)
      setUploadSummary(data.summary)
      setUploadStep('review')
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadLoading(false)
    }
  }, [uploadAccountId])

  const handleDownloadTemplate = useCallback(() => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'bulk-listing-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleUploadSubmit = useCallback(() => {
    const validRows = uploadParsedRows.filter(r => r.errors.length === 0)
    const rows: UploadProgressRow[] = validRows.map(r => ({
      ...r,
      sellerSku: r.sellerSku.trim() || generateSellerSku(),
      status: 'pending' as RowStatus,
    }))
    setUploadProgressRows(rows)
    setUploadIsCreating(true)
    setUploadStep('progress')
  }, [uploadParsedRows])

  // ─── Upload: sequential creation ──────────────────────────────────────

  useEffect(() => {
    if (!uploadIsCreating || uploadCreatingRef.current) return
    uploadCreatingRef.current = true

    const templateCache = new Map<string, string>()

    async function createAll() {
      const rows = [...uploadProgressRows]

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]

        setUploadProgressRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'creating' } : r))

        try {
          const body: Record<string, unknown> = {
            accountId: uploadAccountId,
            sku: row.sellerSku,
            asin: row.asin,
            price: row.price,
            condition: row.condition,
            fulfillmentChannel: uploadFulfillment,
            quantity: row.quantity,
            productId: row.productId,
            gradeId: row.gradeId,
          }
          if (uploadFulfillment === 'MFN' && row.shippingTemplate) {
            const cached = templateCache.get(row.shippingTemplate)
            if (cached) {
              body.shippingTemplateGroupId = cached
            } else {
              body.shippingTemplate = row.shippingTemplate
            }
          }

          const res = await fetch('/api/listings/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          let data: Record<string, unknown>
          try { data = await res.json() } catch { data = { error: `HTTP ${res.status}: ${res.statusText}` } }
          if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`)

          if (data.shippingTemplateGroupId && row.shippingTemplate && !templateCache.has(row.shippingTemplate)) {
            templateCache.set(row.shippingTemplate, data.shippingTemplateGroupId as string)
          }

          setUploadProgressRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'success' } : r))
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          setUploadProgressRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: msg } : r))
        }

        if (i < rows.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 400))
        }
      }

      setUploadIsCreating(false)
      uploadCreatingRef.current = false
    }

    createAll()
  }, [uploadIsCreating]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Upload: computed ─────────────────────────────────────────────────

  const uploadSucceeded = uploadProgressRows.filter(r => r.status === 'success').length
  const uploadFailed = uploadProgressRows.filter(r => r.status === 'error').length

  const handleUploadReset = () => {
    setUploadStep('upload')
    setUploadParsedRows([])
    setUploadSummary(null)
    setUploadError(null)
    setUploadProgressRows([])
    setUploadIsCreating(false)
    uploadCreatingRef.current = false
  }

  const handleClose = () => {
    setStep(0)
    setRawText('')
    setStagingRows([])
    setNotFoundSkus([])
    setListingRows([])
    setProgressRows([])
    setLockedKeys(new Set())
    setIsCreating(false)
    creatingRef.current = false
    handleUploadReset()
  }

  // ─── Render: Error state ─────────────────────────────────────────────────

  if (accountsError && !isBM) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={14} className="shrink-0" />
          {accountsError}
        </div>
      </div>
    )
  }

  // ─── Render: Step 0 — Entry point (Manual / Upload toggle) ──────────────

  if (step === 0) {
    const isUploadMode = mode === 'upload'

    const modeToggle = (
      <div className="flex gap-0 rounded-md border border-gray-300 overflow-hidden w-fit">
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={clsx(
            'px-4 py-2 text-sm font-medium transition-colors',
            !isUploadMode ? 'bg-amazon-blue text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
          )}
        >
          Manual Entry
        </button>
        <button
          type="button"
          onClick={() => setMode('upload')}
          className={clsx(
            'px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300',
            isUploadMode ? 'bg-amazon-blue text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
          )}
        >
          <span className="flex items-center gap-1.5"><Upload size={14} /> Spreadsheet Upload</span>
        </button>
      </div>
    )

    const marketplaceToggle = (
      <div className="flex gap-0 rounded-md border border-gray-300 overflow-hidden w-fit">
        <button
          type="button"
          onClick={() => setMarketplace('amazon')}
          className={clsx(
            'px-4 py-2 text-sm font-medium transition-colors',
            !isBM ? 'bg-amazon-blue text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
          )}
        >
          Amazon
        </button>
        <button
          type="button"
          onClick={() => setMarketplace('backmarket')}
          className={clsx(
            'px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300',
            isBM ? 'bg-amazon-blue text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
          )}
        >
          BackMarket
        </button>
      </div>
    )

    if (!isUploadMode) {
      return (
        <div className="p-6 max-w-2xl space-y-4">
          <div className="flex items-center gap-4">
            {modeToggle}
            {marketplaceToggle}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              Internal Product SKUs (one per line)
            </label>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`SKU-001\nSKU-002\nSKU-003`}
              rows={8}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-y"
            />
          </div>

          {lookupError && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{lookupError}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleLoadSkus}
            disabled={!rawText.trim() || lookupLoading}
            className={clsx(
              'flex items-center justify-center gap-2 h-10 px-6 rounded-md text-sm font-semibold transition-colors',
              rawText.trim() && !lookupLoading
                ? 'bg-amazon-blue text-white hover:bg-amazon-blue/90'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed',
            )}
          >
            {lookupLoading && <Loader2 size={14} className="animate-spin" />}
            {lookupLoading ? 'Loading…' : 'Load SKUs'}
          </button>
        </div>
      )
    }

    // ─── Render: Upload mode ──────────────────────────────────────────────

    return (
      <div className="p-6 max-w-3xl space-y-4">
        {modeToggle}

        {/* ── Upload Step 1: File Upload ───────────────────────────────── */}
        {uploadStep === 'upload' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Account */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Account</label>
                <select
                  value={uploadAccountId}
                  onChange={(e) => setUploadAccountId(e.target.value)}
                  className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.marketplaceName} — {a.sellerId}</option>
                  ))}
                </select>
              </div>
              {/* Fulfillment */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fulfillment</label>
                <div className="flex gap-0 rounded-md border border-gray-300 overflow-hidden w-fit h-9">
                  <button
                    type="button"
                    onClick={() => setUploadFulfillment('MFN')}
                    className={clsx(
                      'px-3 text-sm font-medium transition-colors',
                      uploadFulfillment === 'MFN' ? 'bg-amazon-blue text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    MFN
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadFulfillment('FBA')}
                    className={clsx(
                      'px-3 text-sm font-medium transition-colors border-l border-gray-300',
                      uploadFulfillment === 'FBA' ? 'bg-amazon-blue text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    FBA
                  </button>
                </div>
              </div>
            </div>

            {/* Template download */}
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1.5 text-sm text-amazon-blue hover:underline font-medium"
            >
              <Download size={14} /> Download Template CSV
            </button>

            {/* Drag-and-drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const file = e.dataTransfer.files[0]
                if (file) handleUploadFile(file)
              }}
              className={clsx(
                'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                dragging ? 'border-amazon-blue bg-blue-50' : 'border-gray-300 bg-gray-50',
                uploadLoading && 'opacity-50 pointer-events-none',
              )}
            >
              <FileSpreadsheet size={32} className="mx-auto text-gray-400 mb-3" />
              <p className="text-sm text-gray-600 mb-2">
                Drag and drop your CSV or Excel file here
              </p>
              <p className="text-xs text-gray-400 mb-3">or</p>
              <label className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-semibold cursor-pointer hover:bg-amazon-blue/90">
                <Upload size={14} />
                Choose File
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleUploadFile(file)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>

            {uploadLoading && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Loader2 size={14} className="animate-spin" />
                Parsing and validating file…
              </div>
            )}

            {uploadError && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Upload Step 2: Review ───────────────────────────────────── */}
        {uploadStep === 'review' && uploadSummary && (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex items-center gap-4 text-sm">
              <span className="text-green-700 font-medium">{uploadSummary.valid} valid</span>
              {uploadSummary.errors > 0 && (
                <span className="text-red-600 font-medium">{uploadSummary.errors} errors</span>
              )}
              <span className="text-gray-500">out of {uploadSummary.total} rows</span>
            </div>

            {/* Review table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 w-12">Row</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Grade</th>
                      <th className="px-3 py-2">Seller SKU</th>
                      <th className="px-3 py-2">ASIN</th>
                      <th className="px-3 py-2">Price</th>
                      <th className="px-3 py-2">Condition</th>
                      <th className="px-3 py-2 w-12">Qty</th>
                      {uploadFulfillment === 'MFN' && <th className="px-3 py-2">Template</th>}
                      <th className="px-3 py-2 w-16">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadParsedRows.map((row) => {
                      const hasErrors = row.errors.length > 0
                      return (
                        <tr key={row.rowNum} className={clsx('border-b last:border-0', hasErrors && 'bg-red-50/50')}>
                          <td className="px-3 py-2 text-xs text-gray-400">{row.rowNum}</td>
                          <td className="px-3 py-2 font-mono text-xs">{row.sku}</td>
                          <td className="px-3 py-2 text-xs">
                            {row.gradeName ? (
                              <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                                {row.gradeName}
                              </span>
                            ) : row.grade ? (
                              <span className="text-xs text-gray-500">{row.grade}</span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{row.sellerSku}</td>
                          <td className="px-3 py-2 font-mono text-xs">{row.asin}</td>
                          <td className="px-3 py-2 text-xs">{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</td>
                          <td className="px-3 py-2 text-xs">{row.condition}</td>
                          <td className="px-3 py-2 text-xs text-center">{row.quantity}</td>
                          {uploadFulfillment === 'MFN' && (
                            <td className="px-3 py-2 text-xs text-gray-600">{row.shippingTemplate || '—'}</td>
                          )}
                          <td className="px-3 py-2">
                            {hasErrors ? (
                              <span title={row.errors.join('; ')}>
                                <XCircle size={14} className="text-red-500" />
                              </span>
                            ) : (
                              <CheckCircle2 size={14} className="text-green-600" />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleUploadReset}
                className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                <ArrowLeft size={14} /> Back
              </button>
              <button
                type="button"
                onClick={handleUploadSubmit}
                disabled={uploadSummary.valid === 0}
                className={clsx(
                  'flex items-center gap-2 h-9 px-5 rounded-md text-sm font-semibold transition-colors',
                  uploadSummary.valid > 0
                    ? 'bg-amazon-blue text-white hover:bg-amazon-blue/90'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed',
                )}
              >
                Create {uploadSummary.valid} Valid Listings
              </button>
            </div>
          </div>
        )}

        {/* ── Upload Step 3: Progress ─────────────────────────────────── */}
        {uploadStep === 'progress' && (
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              {uploadIsCreating
                ? `Processing… ${uploadSucceeded + uploadFailed} of ${uploadProgressRows.length}`
                : `Done — ${uploadSucceeded} created, ${uploadFailed} failed`}
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Seller SKU</th>
                      <th className="px-3 py-2">ASIN</th>
                      <th className="px-3 py-2">Price</th>
                      <th className="px-3 py-2 w-16">Status</th>
                      <th className="px-3 py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadProgressRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">{row.sku}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.sellerSku}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.asin}</td>
                        <td className="px-3 py-2 text-xs">${row.price?.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          {row.status === 'pending' && <span className="text-xs text-gray-400">Pending</span>}
                          {row.status === 'creating' && <Loader2 size={14} className="animate-spin text-amazon-blue" />}
                          {row.status === 'success' && <CheckCircle2 size={14} className="text-green-600" />}
                          {row.status === 'error' && <XCircle size={14} className="text-red-500" />}
                        </td>
                        <td className="px-3 py-2 text-xs text-red-600 max-w-[400px] break-words" title={row.error}>
                          {row.error ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary + actions */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {uploadSucceeded > 0 && (
                  <div className="flex items-center gap-1.5 text-sm font-medium text-green-700">
                    <CheckCircle2 size={14} /> {uploadSucceeded} created
                  </div>
                )}
                {uploadFailed > 0 && (
                  <div className="flex items-center gap-1.5 text-sm font-medium text-red-600">
                    <XCircle size={14} /> {uploadFailed} failed
                  </div>
                )}
              </div>
              {!uploadIsCreating && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleUploadReset}
                    className="h-9 px-4 rounded-md border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Upload Another
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Render: Modal backdrop ──────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div
        className={clsx(
          'bg-white rounded-xl shadow-2xl flex flex-col',
          'max-h-[90vh]',
          step === 2 ? (isBM ? 'w-[900px]' : 'w-[1300px]') : 'w-[900px]',
        )}
      >
        {/* ── Step 1: Staging Area ──────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Select Products</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Products expanded by grade. Uncheck any you don&apos;t want to list.
                </p>
              </div>
              <button type="button" onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
              {/* Not-found banner */}
              {notFoundSkus.length > 0 && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 mb-4">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium">SKUs not found:</span>{' '}
                    {notFoundSkus.join(', ')}
                  </div>
                </div>
              )}

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 w-10">
                        <input
                          type="checkbox"
                          checked={stagingRows.length > 0 && stagingRows.filter(r => r.availableQty > 0).every(r => r.checked)}
                          onChange={(e) => {
                            const val = e.target.checked
                            setStagingRows(prev => prev.map(r => r.availableQty > 0 ? { ...r, checked: val } : r))
                          }}
                          className="rounded border-gray-300"
                        />
                      </th>
                      <th className="px-3 py-2">Internal SKU</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2">Grade</th>
                      <th className="px-3 py-2 text-right">Available Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stagingRows.map((row, i) => {
                      const noStock = row.availableQty === 0
                      return (
                        <tr
                          key={`${row.productId}-${row.gradeId ?? 'null'}-${i}`}
                          className={clsx('border-b last:border-0', noStock && 'opacity-40')}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={row.checked}
                              disabled={noStock}
                              onChange={(e) => {
                                setStagingRows(prev => prev.map((r, idx) => idx === i ? { ...r, checked: e.target.checked } : r))
                              }}
                              className="rounded border-gray-300"
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{row.internalSku}</td>
                          <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[250px]">{row.description}</td>
                          <td className="px-3 py-2">
                            {row.gradeName ? (
                              <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                                {row.gradeName}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums">{row.availableQty}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-6 py-4 border-t flex items-center justify-between">
              <span className="text-sm text-gray-500">
                {checkedCount} of {stagingRows.length} selected
              </span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="h-9 px-4 rounded-md border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleNextToForm}
                  disabled={checkedCount === 0}
                  className={clsx(
                    'flex items-center gap-1.5 h-9 px-5 rounded-md text-sm font-semibold transition-colors',
                    checkedCount > 0
                      ? 'bg-amazon-blue text-white hover:bg-amazon-blue/90'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed',
                  )}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Step 2: Listing Details ─────────────────────────────────────── */}
        {step === 2 && (
          <>
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Listing Details</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Set shared defaults, then fill in per-row marketplace details.
                </p>
              </div>
              <button type="button" onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4 space-y-5">
              {/* Shared defaults (Amazon only) */}
              {!isBM && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {/* Account */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Account</label>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.marketplaceName} — {a.sellerId}</option>
                    ))}
                  </select>
                </div>

                {/* Fulfillment */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fulfillment</label>
                  <div className="flex gap-0 rounded-md border border-gray-300 overflow-hidden w-fit h-9">
                    <button
                      type="button"
                      onClick={() => setFulfillment('MFN')}
                      className={clsx(
                        'px-3 text-sm font-medium transition-colors',
                        fulfillment === 'MFN'
                          ? 'bg-amazon-blue text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      MFN
                    </button>
                    <button
                      type="button"
                      onClick={() => setFulfillment('FBA')}
                      className={clsx(
                        'px-3 text-sm font-medium transition-colors border-l border-gray-300',
                        fulfillment === 'FBA'
                          ? 'bg-amazon-blue text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      FBA
                    </button>
                  </div>
                </div>
              </div>
              )}

              {/* Per-row table */}
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-[400px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0">
                      <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                        <th className="px-2 py-2 w-20"></th>
                        <th className="px-2 py-2">Internal SKU</th>
                        <th className="px-2 py-2">Grade</th>
                        <th className="px-2 py-2">Condition</th>
                        {!isBM && <th className="px-2 py-2">Marketplace SKU</th>}
                        <th className="px-2 py-2">{isBM ? 'BMID' : 'ASIN'}</th>
                        <th className="px-2 py-2">Price</th>
                        {!isBM && fulfillment === 'MFN' && <th className="px-2 py-2">Qty</th>}
                        {!isBM && fulfillment === 'MFN' && <th className="px-2 py-2">Template</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // Group rows by productId to detect multi-grade SKUs
                        const groups: { productId: string; internalSku: string; description: string; rows: { row: typeof listingRows[number]; origIdx: number }[] }[] = []
                        const groupMap = new Map<string, number>()
                        listingRows.forEach((row, i) => {
                          const existing = groupMap.get(row.productId)
                          if (existing !== undefined) {
                            groups[existing].rows.push({ row, origIdx: i })
                          } else {
                            groupMap.set(row.productId, groups.length)
                            groups.push({ productId: row.productId, internalSku: row.internalSku, description: row.description, rows: [{ row, origIdx: i }] })
                          }
                        })

                        const colCount = isBM ? 6 : (fulfillment === 'MFN' ? 9 : 7)

                        return groups.map((group) => {
                          const isMulti = group.rows.length > 1
                          return (
                            <Fragment key={group.productId}>
                              <tr className="bg-blue-50/30">
                                <td colSpan={colCount} className="px-3 py-1.5">
                                  <span className="text-xs font-semibold text-blue-700">{group.internalSku}</span>
                                  {isMulti && <span className="text-xs text-blue-500 ml-2">{group.rows.length} grades</span>}
                                </td>
                              </tr>
                                      {group.rows.map(({ row, origIdx: i }) => {
                                        const rowKey = `${row.productId}::${row.gradeId}::${row.marketplaceSku}`
                                        const isLocked = lockedKeys.has(rowKey)
                                        const errs = isLocked ? [] : getRowErrors(row, i)
                                        const hasErr = errs.length > 0 && (row.asin || row.price)
                                        return (
                          <tr key={`${row.productId}-${row.gradeId ?? 'null'}-${i}`} className={clsx('border-b last:border-0', isLocked && 'bg-green-50/50 opacity-60')}>
                            <td className="px-2 py-1.5 w-20">
                              {isLocked ? (
                                <CheckCircle2 size={14} className="text-green-600" />
                              ) : (
                                <div className="flex items-center gap-1">
                                  {hasErr ? (
                                    <span title={errs.join(', ')}><XCircle size={14} className="text-red-500" /></span>
                                  ) : row.asin && row.price ? (
                                    <CheckCircle2 size={14} className="text-green-600" />
                                  ) : <span className="w-3.5" />}
                                  <button
                                    type="button"
                                    title="Duplicate row"
                                    onClick={() => {
                                      const clone: ListingRow = {
                                        productId: row.productId,
                                        internalSku: row.internalSku,
                                        description: row.description,
                                        gradeId: null,
                                        gradeName: null,
                                        availableQty: row.availableQty,
                                        marketplaceSku: '',
                                        asin: '',
                                        price: '',
                                        condition: 'New',
                                        quantity: '0',
                                        shippingTemplate: '',
                                      }
                                      setListingRows(prev => [...prev.slice(0, i + 1), clone, ...prev.slice(i + 1)])
                                    }}
                                    className="p-0.5 text-gray-400 hover:text-amazon-blue rounded"
                                  >
                                    <Plus size={14} />
                                  </button>
                                  {listingRows.length > 1 && (
                                    <button
                                      type="button"
                                      title="Remove row"
                                      onClick={() => setListingRows(prev => prev.filter((_, idx) => idx !== i))}
                                      className="p-0.5 text-gray-400 hover:text-red-500 rounded"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5 font-mono text-xs text-gray-600 whitespace-nowrap">{row.internalSku}</td>
                            <td className="px-2 py-1.5">
                              <select
                                value={row.gradeId ?? ''}
                                disabled={isLocked}
                                onChange={(e) => {
                                  const selectedId = e.target.value || null
                                  const selectedGrade = allGrades.find(g => g.id === selectedId)
                                  setListingRows(prev => prev.map((r, idx) => idx === i ? { ...r, gradeId: selectedId, gradeName: selectedGrade?.grade ?? null } : r))
                                }}
                                className="w-full h-8 rounded-md border border-gray-300 px-1 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:bg-gray-100 disabled:text-gray-500"
                              >
                                <option value="">None</option>
                                {allGrades.map(g => (
                                  <option key={g.id} value={g.id}>{g.grade}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <select
                                value={row.condition}
                                disabled={isLocked}
                                onChange={(e) => setListingRows(prev => prev.map((r, idx) => idx === i ? { ...r, condition: e.target.value } : r))}
                                className="w-full h-8 rounded-md border border-gray-300 px-1 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:bg-gray-100 disabled:text-gray-500"
                              >
                                {(isBM ? BM_CONDITIONS : CONDITIONS).map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </td>
                            {!isBM && (
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={row.marketplaceSku}
                                disabled={isLocked}
                                onChange={(e) => setListingRows(prev => prev.map((r, idx) => idx === i ? { ...r, marketplaceSku: e.target.value } : r))}
                                placeholder="Auto-generated if blank"
                                className="w-full h-8 rounded-md border border-gray-300 px-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:bg-gray-100 disabled:text-gray-500"
                              />
                            </td>
                            )}
                            <td className="px-2 py-1.5">
                              {isBM ? (
                              <input
                                type="text"
                                value={row.asin}
                                disabled={isLocked}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/\D/g, '')
                                  setListingRows(prev => prev.map((r, idx) => idx === i ? { ...r, asin: val } : r))
                                }}
                                placeholder="Catalog product ID"
                                className={clsx(
                                  'w-full h-8 rounded-md border px-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:bg-gray-100 disabled:text-gray-500',
                                  !isLocked && row.asin && !/^\d+$/.test(row.asin) ? 'border-red-400' : 'border-gray-300',
                                )}
                              />
                              ) : (
                              <div className="relative">
                              <input
                                type="text"
                                value={row.asin}
                                disabled={isLocked}
                                onChange={(e) => {
                                  const val = e.target.value.toUpperCase()
                                  setListingRows(prev => prev.map((r, idx) => idx === i ? { ...r, asin: val } : r))
                                  if (ASIN_RE.test(val)) fetchBuyBox(val)
                                }}
                                placeholder={asinSuggestions[row.productId] ? `Suggested: ${asinSuggestions[row.productId]}` : 'B0XXXXXXXXX'}
                                maxLength={10}
                                className={clsx(
                                  'w-full h-8 rounded-md border px-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:bg-gray-100 disabled:text-gray-500',
                                  !isLocked && row.asin && !ASIN_RE.test(row.asin) ? 'border-red-400' :
                                  row.asin && asinSuggestions[row.productId] === row.asin ? 'border-blue-400 bg-blue-50' : 'border-gray-300',
                                )}
                              />
                              {row.asin && asinSuggestions[row.productId] === row.asin && (
                                <span className="absolute -top-1.5 right-1 bg-blue-100 text-blue-700 text-[9px] font-medium px-1 rounded">
                                  suggested
                                </span>
                              )}
                              {ASIN_RE.test(row.asin) && buyBoxData[row.asin] && (
                                <div className="mt-0.5 text-[10px] leading-tight">
                                  {buyBoxData[row.asin].loading ? (
                                    <span className="text-gray-400">Loading buy box…</span>
                                  ) : buyBoxData[row.asin].price != null ? (
                                    <span className="text-gray-500">
                                      Buy Box: <span className="font-semibold text-green-700">${buyBoxData[row.asin].price!.toFixed(2)}</span>
                                      {buyBoxData[row.asin].seller && (
                                        <> · <span className="text-gray-400">{buyBoxData[row.asin].seller}</span></>
                                      )}
                                      {buyBoxData[row.asin].isFba && (
                                        <span className="ml-1 bg-blue-100 text-blue-700 px-1 rounded text-[9px] font-medium">FBA</span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">No buy box data</span>
                                  )}
                                </div>
                              )}
                              </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                value={row.price}
                                disabled={isLocked}
                                onChange={(e) => setListingRows(prev => prev.map((r, idx) => idx === i ? { ...r, price: e.target.value } : r))}
                                placeholder="0.00"
                                min="0.01"
                                step="0.01"
                                className="w-20 h-8 rounded-md border border-gray-300 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:bg-gray-100 disabled:text-gray-500"
                              />
                            </td>
                            {!isBM && fulfillment === 'MFN' && (
                              <td className="px-2 py-1.5">
                                <input
                                  type="number"
                                  value={row.quantity}
                                  disabled={isLocked}
                                  onChange={(e) => setListingRows(prev => prev.map((r, idx) => idx === i ? { ...r, quantity: e.target.value } : r))}
                                  min="0"
                                  step="1"
                                  className="w-16 h-8 rounded-md border border-gray-300 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:bg-gray-100 disabled:text-gray-500"
                                />
                              </td>
                            )}
                            {!isBM && fulfillment === 'MFN' && (
                              <td className="px-2 py-1.5">
                                <select
                                  value={row.shippingTemplate}
                                  disabled={isLocked}
                                  onChange={(e) => setListingRows(prev => prev.map((r, idx) => idx === i ? { ...r, shippingTemplate: e.target.value } : r))}
                                  className="w-full h-8 rounded-md border border-gray-300 px-1 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:bg-gray-100 disabled:text-gray-500"
                                >
                                  <option value="">None</option>
                                  {templates.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                              </td>
                            )}
                          </tr>
                                        )
                                      })}
                            </Fragment>
                          )
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary */}
              <div className="flex items-center gap-4 text-sm">
                <span className="text-green-700 font-medium">{validListingRows.length} valid</span>
                {errorListingRows.length > 0 && (
                  <span className="text-red-600 font-medium">{errorListingRows.length} with errors</span>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                <ArrowLeft size={14} /> Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={validListingRows.length === 0}
                className={clsx(
                  'flex items-center gap-2 h-9 px-5 rounded-md text-sm font-semibold transition-colors',
                  validListingRows.length > 0
                    ? 'bg-amazon-blue text-white hover:bg-amazon-blue/90'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed',
                )}
              >
                Submit {validListingRows.length} {isBM ? 'BM Mappings' : 'Listings'}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Progress ────────────────────────────────────────────── */}
        {step === 3 && (
          <>
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{isBM ? 'Creating BM Mappings' : 'Creating Listings'}</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {isCreating
                    ? `Processing… ${succeededCount + failedCount} of ${progressRows.length}`
                    : `Done — ${succeededCount} created, ${failedCount} failed`}
                </p>
              </div>
              {!isCreating && (
                <button type="button" onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2">Internal SKU</th>
                      <th className="px-3 py-2">Grade</th>
                      {!isBM && <th className="px-3 py-2">Marketplace SKU</th>}
                      <th className="px-3 py-2">{isBM ? 'BMID' : 'ASIN'}</th>
                      {isBM && <th className="px-3 py-2">Condition</th>}
                      {!isBM && <th className="px-3 py-2">Price</th>}
                      <th className="px-3 py-2 w-16">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progressRows.map((row, i) => (
                      <tr key={`${row.productId}-${row.gradeId ?? 'null'}-${i}`} className="border-b last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-gray-600">{row.internalSku}</td>
                        <td className="px-3 py-2">
                          {row.gradeName ? (
                            <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                              {row.gradeName}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        {!isBM && <td className="px-3 py-2 font-mono text-xs">{row.marketplaceSku}</td>}
                        <td className="px-3 py-2 font-mono text-xs">{row.asin}</td>
                        {isBM && <td className="px-3 py-2 text-xs">{row.condition}</td>}
                        {!isBM && <td className="px-3 py-2 text-xs">${row.price}</td>}
                        <td className="px-3 py-2">
                          {row.status === 'pending' && <span className="text-xs text-gray-400">Pending</span>}
                          {row.status === 'creating' && <Loader2 size={14} className="animate-spin text-amazon-blue" />}
                          {row.status === 'success' && <CheckCircle2 size={14} className="text-green-600" />}
                          {row.status === 'error' && (
                            <span className="flex items-center gap-1">
                              <XCircle size={14} className="text-red-500 shrink-0" />
                              <span className="text-xs text-red-600 break-all">{row.error}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-6 py-4 border-t flex items-center justify-between">
              <div className="flex items-center gap-4">
                {succeededCount > 0 && (
                  <div className="flex items-center gap-1.5 text-sm font-medium text-green-700">
                    <CheckCircle2 size={14} />
                    {succeededCount} created
                  </div>
                )}
                {failedCount > 0 && (
                  <div className="flex items-center gap-1.5 text-sm font-medium text-red-600">
                    <XCircle size={14} />
                    {failedCount} failed
                  </div>
                )}
              </div>
              {!isCreating && (
                <div className="flex items-center gap-3">
                  {failedCount > 0 && (
                    <button
                      type="button"
                      onClick={handleBackToEdit}
                      className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50"
                    >
                      <ArrowLeft size={14} /> Edit &amp; Retry
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClose}
                    className="h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-semibold hover:bg-amazon-blue/90"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
