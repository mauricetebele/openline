'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  AlertCircle, CheckCircle2, XCircle, Loader2, Upload, Download, Trash2,
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

const CSV_TEMPLATE = 'SKU,ASIN,Price\nMY-SKU-001,B0XXXXXXXXX,29.99\nMY-SKU-002,B0YYYYYYYYY,49.99\n'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParsedRow {
  sku: string
  asin: string
  price: string
  errors: string[]
}

interface SubmitResult {
  sku: string
  asin: string
  success: boolean
  error?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseRows(text: string): ParsedRow[] {
  if (!text.trim()) return []
  const lines = text.trim().split('\n')
  const rows: ParsedRow[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // Skip header row
    if (/^sku[\t,]/i.test(line)) continue

    // Auto-detect delimiter: tab first, then comma
    const sep = line.includes('\t') ? '\t' : ','
    const parts = line.split(sep).map(s => s.trim())

    const sku = parts[0] ?? ''
    const asin = (parts[1] ?? '').toUpperCase()
    const price = parts[2] ?? ''
    const errors: string[] = []

    if (!sku) errors.push('SKU is empty')
    if (!ASIN_RE.test(asin)) errors.push('Invalid ASIN')
    const priceNum = parseFloat(price)
    if (!price || isNaN(priceNum) || priceNum <= 0) errors.push('Price must be > 0')

    rows.push({ sku, asin, price, errors })
  }
  return rows
}

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'bulk-listing-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BulkListingCreator() {
  // Accounts
  const [accounts, setAccounts] = useState<AmazonAccountDTO[]>([])
  const [accountsError, setAccountsError] = useState<string | null>(null)

  // Templates
  const [templates, setTemplates] = useState<string[]>([])

  // Shared defaults
  const [accountId, setAccountId] = useState('')
  const [condition, setCondition] = useState('New')
  const [fulfillment, setFulfillment] = useState<'MFN' | 'FBA'>('MFN')
  const [quantity, setQuantity] = useState('0')
  const [shippingTemplate, setShippingTemplate] = useState('')

  // Input
  const [rawText, setRawText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Parsed preview
  const [rows, setRows] = useState<ParsedRow[]>([])
  const validRows = rows.filter(r => r.errors.length === 0)
  const errorRows = rows.filter(r => r.errors.length > 0)

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [results, setResults] = useState<SubmitResult[] | null>(null)

  // Load accounts
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

  // Parse rows whenever rawText changes
  useEffect(() => {
    setRows(parseRows(rawText))
  }, [rawText])

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result
      if (typeof text === 'string') setRawText(text)
    }
    reader.readAsText(file)
    // Reset input so same file can be re-uploaded
    e.target.value = ''
  }, [])

  async function handleSubmit() {
    if (validRows.length === 0 || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    setResults(null)

    try {
      const items = validRows.map(r => ({
        sku: r.sku,
        asin: r.asin,
        price: parseFloat(r.price),
      }))

      const body: Record<string, unknown> = {
        accountId,
        condition,
        fulfillmentChannel: fulfillment,
        quantity: parseInt(quantity, 10) || 0,
        items,
      }
      if (fulfillment === 'MFN' && shippingTemplate) {
        body.shippingTemplate = shippingTemplate
      }

      const res = await fetch('/api/listings/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Bulk create failed')

      setResults(data.results)
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Error state ───────────────────────────────────────────────────────────

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

  // ─── Results view ──────────────────────────────────────────────────────────

  if (results) {
    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    return (
      <div className="p-6 max-w-4xl space-y-4">
        {/* Summary */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-green-700">
            <CheckCircle2 size={16} />
            {succeeded} created
          </div>
          {failed > 0 && (
            <div className="flex items-center gap-2 text-sm font-semibold text-red-600">
              <XCircle size={16} />
              {failed} failed
            </div>
          )}
        </div>

        {/* Results table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">ASIN</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    {r.success
                      ? <CheckCircle2 size={14} className="text-green-600" />
                      : <XCircle size={14} className="text-red-500" />}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.sku}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.asin}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.success
                      ? <span className="text-green-700">Created</span>
                      : <span className="text-red-600">{r.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Reset */}
        <button
          type="button"
          onClick={() => { setResults(null); setRawText(''); setRows([]) }}
          className="text-sm text-amazon-blue hover:underline"
        >
          Create more listings
        </button>
      </div>
    )
  }

  // ─── Main form ─────────────────────────────────────────────────────────────

  const qtyNum = parseInt(quantity, 10)
  const canSubmit = validRows.length > 0 && accountId && !submitting

  return (
    <div className="p-6 max-w-4xl space-y-6">

      {/* Error banner */}
      {submitError && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap">{submitError}</span>
        </div>
      )}

      {/* ── Shared Defaults ────────────────────────────────────────────────── */}
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

      {/* ── Input Area ─────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <label className="text-xs font-semibold text-gray-500 uppercase">
            Paste rows (SKU, ASIN, Price)
          </label>
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={downloadTemplate}
              className="flex items-center gap-1.5 text-xs text-amazon-blue hover:underline"
            >
              <Download size={12} /> Template
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 text-xs text-amazon-blue hover:underline"
            >
              <Upload size={12} /> Upload CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            {rawText && (
              <button
                type="button"
                onClick={() => { setRawText(''); setRows([]) }}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500"
              >
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>
        </div>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={`SKU, ASIN, Price\nMY-SKU-001, B0XXXXXXXXX, 29.99\nMY-SKU-002, B0YYYYYYYYY, 49.99`}
          rows={6}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-y"
        />
      </div>

      {/* ── Preview Table ──────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div>
          {/* Summary */}
          <div className="flex items-center gap-4 mb-2 text-sm">
            <span className="text-gray-600">{rows.length} rows parsed</span>
            <span className="text-green-700 font-medium">{validRows.length} valid</span>
            {errorRows.length > 0 && (
              <span className="text-red-600 font-medium">{errorRows.length} errors</span>
            )}
          </div>

          <div className="border rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-3 py-2 w-8">#</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">ASIN</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const hasErr = r.errors.length > 0
                  return (
                    <tr key={i} className={clsx('border-b last:border-0', hasErr && 'bg-red-50')}>
                      <td className="px-3 py-1.5 text-xs text-gray-400">{i + 1}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.sku || <span className="text-gray-300">—</span>}</td>
                      <td className={clsx('px-3 py-1.5 font-mono text-xs', !ASIN_RE.test(r.asin) && r.asin && 'text-red-600')}>
                        {r.asin || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {r.price ? `$${r.price}` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        {hasErr
                          ? <span title={r.errors.join(', ')}><XCircle size={14} className="text-red-500" /></span>
                          : <CheckCircle2 size={14} className="text-green-600" />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Submit ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={clsx(
            'flex items-center justify-center gap-2 h-10 px-6 rounded-md text-sm font-semibold transition-colors',
            canSubmit
              ? 'bg-amazon-blue text-white hover:bg-amazon-blue/90'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed',
          )}
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? `Creating ${validRows.length} listings…` : `Create ${validRows.length} Listings`}
        </button>
        {rows.length > 0 && !submitting && (
          <span className="text-xs text-gray-400">
            Qty: {isNaN(qtyNum) ? 0 : qtyNum} &middot; {condition} &middot; {fulfillment}
          </span>
        )}
      </div>
    </div>
  )
}
