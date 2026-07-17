'use client'
import { useState, useMemo } from 'react'
import { Sparkles, Download, Loader2, AlertTriangle, Pencil, Check, X, GraduationCap } from 'lucide-react'
import { clsx } from 'clsx'

type Confidence = 'high' | 'low' | 'none'
type GuessResult = { sku: string; description: string; confidence: Confidence }
type GuessResponse = { results: GuessResult[]; skippedExisting: string[]; ignored: number }
type Row = GuessResult & { edited?: boolean }

function downloadCsv(rows: Row[]) {
  const header = ['SKU', 'Description', 'Confidence']
  const label = (r: Row) => (r.edited ? 'Corrected' : CONF_LABEL[r.confidence])
  const body = rows.map(r => [r.sku, r.description, label(r)])
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
  const [rows, setRows] = useState<Row[] | null>(null)
  const [meta, setMeta] = useState<{ skippedExisting: string[] } | null>(null)

  // Inline-edit state
  const [editingSku, setEditingSku] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savingSku, setSavingSku] = useState<string | null>(null)

  const stats = useMemo(() => {
    if (!rows) return null
    return {
      high: rows.filter(r => r.confidence === 'high' && !r.edited).length,
      low: rows.filter(r => r.confidence === 'low' && !r.edited).length,
      none: rows.filter(r => r.confidence === 'none' && !r.edited).length,
      edited: rows.filter(r => r.edited).length,
    }
  }, [rows])

  async function run() {
    setLoading(true)
    setErr(null)
    setRows(null)
    setMeta(null)
    setEditingSku(null)
    try {
      const res = await fetch('/api/description-guesser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input }),
      })
      const json: GuessResponse = await res.json()
      if (!res.ok) throw new Error((json as unknown as { error?: string }).error ?? 'Failed to guess descriptions')
      setRows(json.results.map(r => ({ ...r })))
      setMeta({ skippedExisting: json.skippedExisting })
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to guess descriptions')
    } finally {
      setLoading(false)
    }
  }

  function startEdit(r: Row) {
    setEditingSku(r.sku)
    setDraft(r.description)
  }

  async function saveEdit(sku: string) {
    const description = draft.trim()
    if (!description) return
    setSavingSku(sku)
    try {
      const res = await fetch('/api/description-guesser/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, description }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to save correction')
      setRows(prev =>
        (prev ?? []).map(r => (r.sku === sku ? { ...r, description, edited: true } : r)),
      )
      setEditingSku(null)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to save correction')
    } finally {
      setSavingSku(null)
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
            Read-only for your catalog — nothing is saved to Products. SKUs that already exist are
            skipped. Guesses are best-effort; edit any row to correct it and the tool learns for next time.
          </p>
        </div>

        {err && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            <AlertTriangle size={16} /> {err}
          </div>
        )}

        {/* Results */}
        {rows && meta && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{rows.length}</span> guessed
                {stats && (
                  <span className="text-gray-400">
                    {'  '}· {stats.high} high · {stats.low} review
                    {stats.none ? ` · ${stats.none} no match` : ''}
                    {stats.edited ? ` · ${stats.edited} corrected` : ''}
                  </span>
                )}
                {meta.skippedExisting.length > 0 && (
                  <span className="text-gray-400">{'  '}· {meta.skippedExisting.length} already exist (skipped)</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => downloadCsv(rows)}
                disabled={rows.length === 0}
                className="flex items-center gap-2 border border-gray-300 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <Download size={15} /> Download CSV
              </button>
            </div>

            {rows.length === 0 ? (
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
                      <th className="text-right font-medium px-4 py-2 w-28"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => {
                      const isEditing = editingSku === r.sku
                      return (
                        <tr key={r.sku} className="hover:bg-gray-50 align-top">
                          <td className="px-4 py-2 font-mono text-xs text-gray-800 whitespace-nowrap">{r.sku}</td>
                          <td className="px-4 py-2 text-gray-800">
                            {isEditing ? (
                              <input
                                autoFocus
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveEdit(r.sku)
                                  if (e.key === 'Escape') setEditingSku(null)
                                }}
                                className="w-full border border-amazon-blue rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                              />
                            ) : (
                              r.description || <span className="text-gray-400 italic">— could not guess —</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {r.edited ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                <GraduationCap size={12} /> Corrected
                              </span>
                            ) : (
                              <span className={clsx('inline-block text-xs font-medium px-2 py-0.5 rounded-full', CONF_STYLES[r.confidence])}>
                                {CONF_LABEL[r.confidence]}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {isEditing ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => saveEdit(r.sku)}
                                  disabled={savingSku === r.sku || !draft.trim()}
                                  className="inline-flex items-center gap-1 bg-amazon-blue text-white text-xs px-2 py-1 rounded hover:opacity-90 disabled:opacity-50"
                                >
                                  {savingSku === r.sku ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingSku(null)}
                                  className="inline-flex items-center text-gray-400 hover:text-gray-600 px-1 py-1"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => startEdit(r)}
                                className="inline-flex items-center gap-1 text-gray-500 hover:text-amazon-blue text-xs font-medium"
                              >
                                <Pencil size={12} /> Modify
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {meta.skippedExisting.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
                <details>
                  <summary className="text-xs text-gray-500 cursor-pointer">
                    {meta.skippedExisting.length} SKU{meta.skippedExisting.length === 1 ? '' : 's'} already exist — skipped
                  </summary>
                  <div className="mt-2 font-mono text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                    {meta.skippedExisting.map(s => <span key={s}>{s}</span>)}
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
