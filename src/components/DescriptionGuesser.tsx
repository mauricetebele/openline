'use client'
import { useState, useMemo } from 'react'
import { Sparkles, Download, Loader2, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'

type Confidence = 'high' | 'low' | 'none'
type GuessResult = { sku: string; description: string; confidence: Confidence }
type GuessResponse = { results: GuessResult[]; skippedExisting: string[]; ignored: number }

function downloadCsv(rows: GuessResult[]) {
  const header = ['SKU', 'Description']
  const body = rows.map(r => [r.sku, r.description])
  const csv = [header, ...body]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `guessed-descriptions-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const CONF_STYLES: Record<Confidence, string> = {
  high: 'bg-green-100 text-green-700',
  low: 'bg-amber-100 text-amber-700',
  none: 'bg-gray-100 text-gray-500',
}
const CONF_LABEL: Record<Confidence, string> = { high: 'High', low: 'Review', none: 'No match' }

export default function DescriptionGuesser() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [data, setData] = useState<GuessResponse | null>(null)

  const stats = useMemo(() => {
    if (!data) return null
    const high = data.results.filter(r => r.confidence === 'high').length
    const low = data.results.filter(r => r.confidence === 'low').length
    const none = data.results.filter(r => r.confidence === 'none').length
    return { high, low, none }
  }, [data])

  async function run() {
    setLoading(true)
    setErr(null)
    setData(null)
    try {
      const res = await fetch('/api/description-guesser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to guess descriptions')
      setData(json as GuessResponse)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to guess descriptions')
    } finally {
      setLoading(false)
    }
  }

  const inputCount = input.split(/\r?\n/).map(s => s.trim()).filter(Boolean).length

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-5 max-w-4xl space-y-5">
        {/* Input */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            Paste SKUs — one per line
          </label>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            rows={10}
            placeholder={'IPHONE-16-256-TEAL-UNLK-RW\nPIXEL-8-128-HAZEL-UNLK-NIB\nSAM-S918U-512-BLACK-UNLK-A'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-y"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">{inputCount} SKU{inputCount === 1 ? '' : 's'}</span>
            <button
              type="button"
              onClick={run}
              disabled={loading || inputCount === 0}
              className="flex items-center gap-2 bg-amazon-blue text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? 'Guessing…' : 'Guess Descriptions'}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Read-only — nothing is saved to the catalog. SKUs that already exist are skipped.
            Descriptions are best-effort guesses; always review before importing.
          </p>
        </div>

        {err && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            <AlertTriangle size={16} /> {err}
          </div>
        )}

        {/* Results */}
        {data && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{data.results.length}</span> guessed
                {stats && (
                  <span className="text-gray-400">
                    {'  '}· {stats.high} high · {stats.low} review{stats.none ? ` · ${stats.none} no match` : ''}
                  </span>
                )}
                {data.skippedExisting.length > 0 && (
                  <span className="text-gray-400">{'  '}· {data.skippedExisting.length} already exist (skipped)</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => downloadCsv(data.results)}
                disabled={data.results.length === 0}
                className="flex items-center gap-2 border border-gray-300 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <Download size={15} /> Download CSV
              </button>
            </div>

            {data.results.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                Nothing to guess — every SKU you entered already exists in the catalog.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left font-medium px-4 py-2">SKU</th>
                      <th className="text-left font-medium px-4 py-2">Guessed Description</th>
                      <th className="text-left font-medium px-4 py-2 w-24">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.results.map(r => (
                      <tr key={r.sku} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs text-gray-800 whitespace-nowrap">{r.sku}</td>
                        <td className="px-4 py-2 text-gray-800">
                          {r.description || <span className="text-gray-400 italic">— could not guess —</span>}
                        </td>
                        <td className="px-4 py-2">
                          <span className={clsx('inline-block text-xs font-medium px-2 py-0.5 rounded-full', CONF_STYLES[r.confidence])}>
                            {CONF_LABEL[r.confidence]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.skippedExisting.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
                <details>
                  <summary className="text-xs text-gray-500 cursor-pointer">
                    {data.skippedExisting.length} SKU{data.skippedExisting.length === 1 ? '' : 's'} already exist — skipped
                  </summary>
                  <div className="mt-2 font-mono text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                    {data.skippedExisting.map(s => <span key={s}>{s}</span>)}
                  </div>
                </details>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
