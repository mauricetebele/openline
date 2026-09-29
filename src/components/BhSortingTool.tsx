'use client'
import { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import { BatteryCharging, ScanLine, RotateCcw } from 'lucide-react'

type Verdict = 'good' | 'bad' | 'no_bh' | 'not_found' | 'not_in_stock'

interface Scan {
  serial: string
  verdict: Verdict
  bh: number | null
  sku: string | null
  model: string | null
  grade: string | null
}

export default function BhSortingTool() {
  const [threshold, setThreshold] = useState('80')
  const [started, setStarted] = useState(false)
  const [scan, setScan] = useState('')
  const [current, setCurrent] = useState<Scan | null>(null)
  const [log, setLog] = useState<Scan[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const th = Number(threshold)

  useEffect(() => { if (started) inputRef.current?.focus() }, [started, current])

  async function lookup(serialRaw: string) {
    const serial = serialRaw.trim()
    if (!serial) return
    setLoading(true)
    try {
      const res = await fetch(`/api/inventory/battery-health/lookup?serial=${encodeURIComponent(serial)}`)
      const d = await res.json()
      let verdict: Verdict
      if (!d.found) verdict = 'not_found'
      else if (d.status !== 'IN_STOCK') verdict = 'not_in_stock'
      else if (d.batteryHealthPct == null) verdict = 'no_bh'
      else verdict = d.batteryHealthPct >= th ? 'good' : 'bad'
      const s: Scan = { serial: d.serialNumber ?? serial, verdict, bh: d.batteryHealthPct ?? null, sku: d.sku ?? null, model: d.model ?? null, grade: d.grade ?? null }
      setCurrent(s)
      setLog(prev => [s, ...prev].slice(0, 50))
    } catch {
      setCurrent({ serial, verdict: 'not_found', bh: null, sku: null, model: null, grade: null })
    } finally {
      setLoading(false)
      setScan('')
      inputRef.current?.focus()
    }
  }

  const goodCount = log.filter(s => s.verdict === 'good').length
  const badCount = log.filter(s => s.verdict === 'bad').length

  // ── Threshold prompt ─────────────────────────────────────────────────────────
  if (!started) {
    return (
      <div className="max-w-md mx-auto mt-10 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4 text-center">
        <BatteryCharging size={40} className="mx-auto text-amazon-blue" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">BH Sorting Tool</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Set the battery-health threshold. Units at or above it flash <span className="font-semibold text-emerald-600">green (Good)</span>; below it flash <span className="font-semibold text-red-600">red</span>.</p>
        <div className="flex items-center justify-center gap-2">
          <input
            type="number" min={0} max={100} value={threshold}
            onChange={e => setThreshold(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && threshold !== '') setStarted(true) }}
            className="h-12 w-28 text-center text-2xl font-bold rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            autoFocus
          />
          <span className="text-2xl font-bold text-gray-400">%</span>
        </div>
        <button
          onClick={() => setStarted(true)}
          disabled={threshold === '' || th < 0 || th > 100}
          className="w-full h-11 rounded-md bg-amazon-blue text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          Start scanning
        </button>
      </div>
    )
  }

  // ── Scanning view ─────────────────────────────────────────────────────────────
  const bg =
    current?.verdict === 'good' ? 'bg-emerald-500'
    : current?.verdict === 'bad' ? 'bg-red-500'
    : current?.verdict === 'no_bh' ? 'bg-amber-400'
    : current ? 'bg-gray-500'
    : 'bg-gray-100 dark:bg-gray-800'

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-600 dark:text-gray-300">Threshold: <span className="font-bold text-gray-900 dark:text-gray-100">{th}%</span></span>
        <button onClick={() => { setStarted(false); setCurrent(null) }} className="text-xs text-amazon-blue hover:underline">change</button>
        <div className="relative">
          <ScanLine size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            ref={inputRef}
            value={scan}
            onChange={e => setScan(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') lookup(scan) }}
            placeholder="Scan serial / IMEI…"
            className="h-10 w-64 pl-7 pr-2 rounded-md border-2 border-amazon-blue text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue/30"
            autoFocus
          />
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">{goodCount} good</span>
          <span className="inline-flex items-center gap-1 font-semibold text-red-600">{badCount} below</span>
          <button onClick={() => { setLog([]); setCurrent(null); inputRef.current?.focus() }} title="Clear session" className="text-gray-400 hover:text-gray-600"><RotateCcw size={15} /></button>
        </div>
      </div>

      {/* Big verdict card — designed for across-the-room scanning */}
      <div className={clsx('rounded-2xl text-white transition-colors duration-100 flex flex-col items-center justify-center text-center px-6 py-12 min-h-[46vh]', bg, current && (current.verdict === 'good' || current.verdict === 'bad') && 'animate-pulse')}>
        {!current ? (
          <p className="text-gray-400 dark:text-gray-500 text-lg font-medium">Scan a unit to begin…</p>
        ) : current.verdict === 'good' || current.verdict === 'bad' ? (
          <>
            <div className="text-[13vw] leading-none font-black tabular-nums">{current.bh}%</div>
            <div className="mt-2 text-4xl font-extrabold uppercase tracking-wide">{current.verdict === 'good' ? 'GOOD' : 'BELOW'}</div>
            <div className="mt-4 text-2xl font-semibold">{current.model ?? current.sku ?? '—'}</div>
            <div className="text-lg opacity-90">{current.sku}{current.grade ? ` · Grade ${current.grade}` : ''}</div>
            <div className="mt-1 font-mono text-sm opacity-80">{current.serial}</div>
          </>
        ) : (
          <>
            <div className="text-5xl font-black uppercase">
              {current.verdict === 'no_bh' ? 'No BH on file' : current.verdict === 'not_in_stock' ? 'Not in stock' : 'Not found'}
            </div>
            {current.model && <div className="mt-3 text-2xl font-semibold">{current.model}</div>}
            <div className="mt-1 font-mono text-sm opacity-80">{current.serial}</div>
          </>
        )}
        {loading && <div className="mt-4 text-sm opacity-80">…</div>}
      </div>

      {/* Recent scans */}
      {log.length > 0 && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs">
              <tr><th className="text-left px-3 py-2">Serial</th><th className="text-left px-3 py-2">Model</th><th className="text-right px-3 py-2">BH %</th><th className="text-left px-3 py-2 w-24">Result</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {log.map((s, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 font-mono text-xs text-gray-700 dark:text-gray-300">{s.serial}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300">{s.model ?? s.sku ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{s.bh ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    <span className={clsx('inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium',
                      s.verdict === 'good' ? 'bg-emerald-100 text-emerald-700'
                      : s.verdict === 'bad' ? 'bg-red-100 text-red-700'
                      : s.verdict === 'no_bh' ? 'bg-amber-100 text-amber-800'
                      : 'bg-gray-100 text-gray-500')}>
                      {s.verdict === 'good' ? 'Good' : s.verdict === 'bad' ? 'Below' : s.verdict === 'no_bh' ? 'No BH' : s.verdict === 'not_in_stock' ? 'Not in stock' : 'Not found'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
