'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  AlertCircle, CheckCircle2, XCircle, Loader2, ChevronRight, ArrowLeft, X,
} from 'lucide-react'
import { clsx } from 'clsx'
import { AmazonAccountDTO } from '@/types'

// ─── Constants ───────────────────────────────────────────────────────────────

const ASIN_RE = /^B0[A-Z0-9]{8}$/

const CONDITIONS = [
  'New',
  'Used - Like New',
  'Used - Very Good',
  'Used - Good',
  'Used - Acceptable',
  'Refurbished',
]

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
}

type RowStatus = 'pending' | 'creating' | 'success' | 'error'

interface ProgressRow extends ListingRow {
  status: RowStatus
  error?: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BulkListingCreator() {
  // Step: 0=page textarea, 1=staging, 2=form, 3=progress
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0)

  // Step 0 — raw input
  const [rawText, setRawText] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)

  // Step 1 — staging
  const [stagingRows, setStagingRows] = useState<StagingRow[]>([])
  const [notFoundSkus, setNotFoundSkus] = useState<string[]>([])

  // Step 2 — listing details
  const [listingRows, setListingRows] = useState<ListingRow[]>([])
  const [accounts, setAccounts] = useState<AmazonAccountDTO[]>([])
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<string[]>([])
  const [accountId, setAccountId] = useState('')
  const [condition, setCondition] = useState('New')
  const [fulfillment, setFulfillment] = useState<'MFN' | 'FBA'>('MFN')
  const [quantity, setQuantity] = useState('0')
  const [shippingTemplate, setShippingTemplate] = useState('')

  // Step 3 — progress
  const [progressRows, setProgressRows] = useState<ProgressRow[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const creatingRef = useRef(false)

  // ─── Load accounts on mount ──────────────────────────────────────────────

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
      })
      .catch((err) => setAccountsError(err.message))
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

  const handleNextToForm = useCallback(() => {
    const checked = stagingRows.filter(r => r.checked)
    const rows: ListingRow[] = checked.map(r => ({
      productId: r.productId,
      internalSku: r.internalSku,
      description: r.description,
      gradeId: r.gradeId,
      gradeName: r.gradeName,
      availableQty: r.availableQty,
      marketplaceSku: '',
      asin: '',
      price: '',
    }))
    setListingRows(rows)
    setStep(2)
  }, [stagingRows])

  // ─── Step 2 validation ──────────────────────────────────────────────────

  const getRowErrors = (row: ListingRow): string[] => {
    const errs: string[] = []
    if (!row.marketplaceSku.trim()) errs.push('SKU required')
    if (!ASIN_RE.test(row.asin)) errs.push('Invalid ASIN')
    const p = parseFloat(row.price)
    if (!row.price || isNaN(p) || p <= 0) errs.push('Price > 0')
    return errs
  }

  const validListingRows = listingRows.filter(r => getRowErrors(r).length === 0)
  const errorListingRows = listingRows.filter(r => getRowErrors(r).length > 0)

  // ─── Step 2 → Step 3: Submit ─────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    const rows: ProgressRow[] = validListingRows.map(r => ({
      ...r,
      status: 'pending' as RowStatus,
    }))
    setProgressRows(rows)
    setIsCreating(true)
    setStep(3)
  }, [validListingRows])

  // ─── Step 3: Sequential creation ─────────────────────────────────────────

  useEffect(() => {
    if (!isCreating || creatingRef.current) return
    creatingRef.current = true

    let cachedTemplateGroupId: string | undefined

    async function createAll() {
      const rows = [...progressRows]
      const qtyNum = parseInt(quantity, 10) || 0

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]

        // Update status to 'creating'
        setProgressRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'creating' } : r))

        try {
          const body: Record<string, unknown> = {
            accountId,
            sku: row.marketplaceSku.trim(),
            asin: row.asin,
            price: parseFloat(row.price),
            condition,
            fulfillmentChannel: fulfillment,
            quantity: qtyNum,
            productId: row.productId,
            gradeId: row.gradeId,
          }
          if (fulfillment === 'MFN' && shippingTemplate) {
            if (cachedTemplateGroupId) {
              body.shippingTemplateGroupId = cachedTemplateGroupId
            } else {
              body.shippingTemplate = shippingTemplate
            }
          }

          const res = await fetch('/api/listings/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Failed')

          // Cache the resolved template group ID for subsequent calls
          if (data.shippingTemplateGroupId && !cachedTemplateGroupId) {
            cachedTemplateGroupId = data.shippingTemplateGroupId
          }

          setProgressRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'success' } : r))
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

  const handleClose = () => {
    setStep(0)
    setRawText('')
    setStagingRows([])
    setNotFoundSkus([])
    setListingRows([])
    setProgressRows([])
    setIsCreating(false)
    creatingRef.current = false
  }

  // ─── Render: Error state ─────────────────────────────────────────────────

  if (accountsError) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={14} className="shrink-0" />
          {accountsError}
        </div>
      </div>
    )
  }

  // ─── Render: Step 0 — Textarea ───────────────────────────────────────────

  if (step === 0) {
    return (
      <div className="p-6 max-w-2xl space-y-4">
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

  // ─── Render: Modal backdrop ──────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div
        className={clsx(
          'bg-white rounded-xl shadow-2xl flex flex-col',
          'max-h-[90vh]',
          step === 2 ? 'w-[1100px]' : 'w-[900px]',
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
              {/* Shared defaults */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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

                {/* Condition */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Condition</label>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
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

                {/* Quantity */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Quantity</label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    min="0"
                    step="1"
                    className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                  />
                </div>

                {/* Shipping Template (MFN only) */}
                {fulfillment === 'MFN' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Template</label>
                    <select
                      value={shippingTemplate}
                      onChange={(e) => setShippingTemplate(e.target.value)}
                      className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                    >
                      <option value="">None (default)</option>
                      {templates.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Per-row table */}
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-[400px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0">
                      <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                        <th className="px-3 py-2">Internal SKU</th>
                        <th className="px-3 py-2">Grade</th>
                        <th className="px-3 py-2">Marketplace SKU</th>
                        <th className="px-3 py-2">ASIN</th>
                        <th className="px-3 py-2">Price</th>
                        <th className="px-3 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {listingRows.map((row, i) => {
                        const errs = getRowErrors(row)
                        const hasErr = errs.length > 0 && (row.marketplaceSku || row.asin || row.price)
                        return (
                          <tr key={`${row.productId}-${row.gradeId ?? 'null'}-${i}`} className="border-b last:border-0">
                            <td className="px-3 py-1.5 font-mono text-xs text-gray-600">{row.internalSku}</td>
                            <td className="px-3 py-1.5">
                              {row.gradeName ? (
                                <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                                  {row.gradeName}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5">
                              <input
                                type="text"
                                value={row.marketplaceSku}
                                onChange={(e) => setListingRows(prev => prev.map((r, idx) => idx === i ? { ...r, marketplaceSku: e.target.value } : r))}
                                placeholder="MSKU-001"
                                className="w-full h-8 rounded-md border border-gray-300 px-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input
                                type="text"
                                value={row.asin}
                                onChange={(e) => setListingRows(prev => prev.map((r, idx) => idx === i ? { ...r, asin: e.target.value.toUpperCase() } : r))}
                                placeholder="B0XXXXXXXXX"
                                maxLength={10}
                                className={clsx(
                                  'w-full h-8 rounded-md border px-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue',
                                  row.asin && !ASIN_RE.test(row.asin) ? 'border-red-400' : 'border-gray-300',
                                )}
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input
                                type="number"
                                value={row.price}
                                onChange={(e) => setListingRows(prev => prev.map((r, idx) => idx === i ? { ...r, price: e.target.value } : r))}
                                placeholder="0.00"
                                min="0.01"
                                step="0.01"
                                className="w-24 h-8 rounded-md border border-gray-300 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              {hasErr ? (
                                <span title={errs.join(', ')}><XCircle size={14} className="text-red-500" /></span>
                              ) : row.marketplaceSku && row.asin && row.price ? (
                                <CheckCircle2 size={14} className="text-green-600" />
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
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
                Submit {validListingRows.length} Listings
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Progress ────────────────────────────────────────────── */}
        {step === 3 && (
          <>
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Creating Listings</h2>
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
                      <th className="px-3 py-2">Marketplace SKU</th>
                      <th className="px-3 py-2">ASIN</th>
                      <th className="px-3 py-2">Price</th>
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
                        <td className="px-3 py-2 font-mono text-xs">{row.marketplaceSku}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.asin}</td>
                        <td className="px-3 py-2 text-xs">${row.price}</td>
                        <td className="px-3 py-2">
                          {row.status === 'pending' && <span className="text-xs text-gray-400">Pending</span>}
                          {row.status === 'creating' && <Loader2 size={14} className="animate-spin text-amazon-blue" />}
                          {row.status === 'success' && <CheckCircle2 size={14} className="text-green-600" />}
                          {row.status === 'error' && (
                            <span title={row.error}>
                              <XCircle size={14} className="text-red-500" />
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
                <button
                  type="button"
                  onClick={handleClose}
                  className="h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-semibold hover:bg-amazon-blue/90"
                >
                  Close
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
