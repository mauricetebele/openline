'use client'
import { useState } from 'react'
import { Search, Loader2, Copy, Check, AlertTriangle, FileText } from 'lucide-react'

interface Result {
  response: string
  order: { amazonOrderId: string; olmNumber: number | null; shipped: boolean }
  warnings: string[]
}

export default function ChargebackResponseGenerator() {
  const [orderInput, setOrderInput] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function generate() {
    const q = orderInput.trim()
    if (!q) return
    setLoading(true); setError(null); setResult(null); setCopied(false)
    try {
      const res = await fetch(`/api/chargeback-response?order=${encodeURIComponent(q)}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed to generate')
      setResult(d)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to generate') }
    finally { setLoading(false) }
  }

  function copy() {
    if (!result) return
    navigator.clipboard.writeText(result.response)
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-1">
        <FileText size={18} className="text-amazon-blue" />
        <h1 className="text-xl font-semibold text-gray-900">Chargeback Response Generator</h1>
      </div>
      <p className="text-sm text-gray-500 mb-5">Paste an Amazon order # (or OLM-#). The shipped confirmation, date, carrier, shipper link, and tracking number are filled from the order; the policy and return address are standard.</p>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={orderInput}
            onChange={e => setOrderInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') generate() }}
            placeholder="111-1234567-1234567 or OLM-1234"
            className="w-full h-11 rounded-lg border border-gray-300 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>
        <button onClick={generate} disabled={loading || !orderInput.trim()}
          className="h-11 px-5 rounded-lg bg-amazon-blue text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-2">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Generate
        </button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {result && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{result.order.amazonOrderId}</span>
              {result.order.olmNumber != null && <span className="text-gray-400"> · OLM-{result.order.olmNumber}</span>}
              <span className={`ml-2 text-[11px] font-semibold px-1.5 py-0.5 rounded ${result.order.shipped ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{result.order.shipped ? 'Shipped' : 'Not shipped'}</span>
            </div>
            <button onClick={copy} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">
              {copied ? <><Check size={14} className="text-green-600" /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
          </div>

          {result.warnings.length > 0 && (
            <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[12px] text-amber-800 space-y-0.5">
              {result.warnings.map((w, i) => <div key={i} className="flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> {w}</div>)}
            </div>
          )}

          <textarea
            value={result.response}
            readOnly
            rows={24}
            className="w-full rounded-lg border border-gray-300 p-3 text-[13px] font-mono leading-relaxed text-gray-800 bg-gray-50 focus:outline-none"
          />
        </div>
      )}
    </div>
  )
}
