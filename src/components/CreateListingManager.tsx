'use client'
import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { AmazonAccountDTO } from '@/types'

const ASIN_RE = /^B0[A-Z0-9]{8}$/

const CONDITIONS = [
  'New',
  'Used - Like New',
  'Used - Very Good',
  'Used - Good',
  'Used - Acceptable',
  'Refurbished',
]

export default function CreateListingManager() {
  // Accounts
  const [accounts, setAccounts] = useState<AmazonAccountDTO[]>([])
  const [accountsError, setAccountsError] = useState<string | null>(null)

  // Templates (loaded per-account)
  const [templates, setTemplates] = useState<string[]>([])

  // Form state
  const [accountId, setAccountId] = useState('')
  const [asin, setAsin] = useState('')
  const [sku, setSku] = useState('')
  const [fulfillment, setFulfillment] = useState<'MFN' | 'FBA'>('MFN')
  const [condition, setCondition] = useState('New')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('0')
  const [shippingTemplate, setShippingTemplate] = useState('')

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
      .then((data) => {
        if (data.templates) setTemplates(data.templates)
      })
      .catch(() => {})
  }, [accountId])

  const asinValid = ASIN_RE.test(asin)
  const priceNum = parseFloat(price)
  const qtyNum = parseInt(quantity, 10)
  const canSubmit =
    accountId &&
    asin &&
    asinValid &&
    sku.trim() &&
    price &&
    !isNaN(priceNum) &&
    priceNum > 0 &&
    !isNaN(qtyNum) &&
    qtyNum >= 0 &&
    !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const body: Record<string, unknown> = {
        accountId,
        sku: sku.trim(),
        asin,
        price: priceNum,
        quantity: qtyNum,
        condition,
        fulfillmentChannel: fulfillment,
      }
      if (fulfillment === 'MFN' && shippingTemplate) {
        body.shippingTemplate = shippingTemplate
      }

      const res = await fetch('/api/listings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create listing')

      setSuccess(`Listing created — SKU: ${data.sku}, Status: ${data.status}${data.submissionId ? `, Submission: ${data.submissionId}` : ''}`)
      // Reset form
      setAsin('')
      setSku('')
      setPrice('')
      setQuantity('0')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

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

  return (
    <form onSubmit={handleSubmit} className="p-6 max-w-xl space-y-5">

      {/* Error / Success banners */}
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

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

      {/* ASIN */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">ASIN</label>
        <input
          type="text"
          value={asin}
          onChange={(e) => setAsin(e.target.value.toUpperCase())}
          placeholder="B0XXXXXXXXX"
          maxLength={10}
          className={clsx(
            'w-full h-9 rounded-md border px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue',
            asin && !asinValid ? 'border-red-400' : 'border-gray-300',
          )}
        />
        {asin && !asinValid && (
          <p className="text-xs text-red-500 mt-1">Must match B0 + 8 alphanumeric characters</p>
        )}
      </div>

      {/* SKU */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">New SKU</label>
        <input
          type="text"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder="MY-SKU-001"
          className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue"
        />
      </div>

      {/* Fulfillment Channel */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fulfillment</label>
        <div className="flex gap-0 rounded-md border border-gray-300 overflow-hidden w-fit">
          <button
            type="button"
            onClick={() => setFulfillment('MFN')}
            className={clsx(
              'px-4 py-1.5 text-sm font-medium transition-colors',
              fulfillment === 'MFN'
                ? 'bg-amazon-blue text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            Merchant Fulfilled
          </button>
          <button
            type="button"
            onClick={() => setFulfillment('FBA')}
            className={clsx(
              'px-4 py-1.5 text-sm font-medium transition-colors border-l border-gray-300',
              fulfillment === 'FBA'
                ? 'bg-amazon-blue text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            FBA
          </button>
        </div>
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

      {/* Price */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Price (USD)</label>
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          min="0.01"
          step="0.01"
          className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
        />
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
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Shipping Template</label>
          <select
            value={shippingTemplate}
            onChange={(e) => setShippingTemplate(e.target.value)}
            className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          >
            <option value="">None (use account default)</option>
            {templates.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={clsx(
          'flex items-center justify-center gap-2 h-10 px-6 rounded-md text-sm font-semibold transition-colors',
          canSubmit
            ? 'bg-amazon-blue text-white hover:bg-amazon-blue/90'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed',
        )}
      >
        {submitting && <Loader2 size={14} className="animate-spin" />}
        {submitting ? 'Creating…' : 'Create Listing'}
      </button>
    </form>
  )
}
