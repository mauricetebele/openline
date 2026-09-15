'use client'
/**
 * Reprint guard with an in-app modal (not window.confirm).
 *
 * `confirmReprint(orderId)` checks the Label Print History; if the order's label was
 * already printed, it opens a designed modal showing the last-printed timestamp and
 * resolves to the user's choice. Mount <ReprintConfirmHost/> once (root layout).
 *
 *   if (!(await confirmReprint(orderId))) return
 */
import { useState, useEffect } from 'react'
import { AlertTriangle, Printer, X } from 'lucide-react'

interface ReprintInfo { lastPrintedAt: string; count: number }

// Module-level bridge so any handler can await the singleton modal.
let opener: ((info: ReprintInfo) => Promise<boolean>) | null = null

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export async function confirmReprint(orderId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/label-print-info?id=${encodeURIComponent(orderId)}`)
    if (!res.ok) return true
    const info = await res.json() as { count?: number; lastPrintedAt?: string | null }
    if ((info.count ?? 0) > 0 && info.lastPrintedAt) {
      if (opener) return opener({ lastPrintedAt: info.lastPrintedAt, count: info.count ?? 0 })
      // Fallback if the host isn't mounted.
      return window.confirm(`This label was previously printed at:\n${fmtTs(info.lastPrintedAt)}\n\nAre you sure you want to print it again?`)
    }
  } catch { /* check failed — never block a legitimate print */ }
  return true
}

export function ReprintConfirmHost() {
  const [state, setState] = useState<{ info: ReprintInfo; resolve: (v: boolean) => void } | null>(null)

  useEffect(() => {
    opener = (info) => new Promise<boolean>((resolve) => setState({ info, resolve }))
    return () => { opener = null }
  }, [])

  if (!state) return null
  const { info, resolve } = state
  const close = (v: boolean) => { resolve(v); setState(null) }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={() => close(false)}>
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <AlertTriangle size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Label already printed</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">This shipping label was previously printed.</p>
            </div>
            <button onClick={() => close(false)} className="ml-auto -mr-1 -mt-1 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5"><X size={16} /></button>
          </div>

          <div className="mt-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 px-3.5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Last printed</div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums">{fmtTs(info.lastPrintedAt)}</div>
            {info.count > 1 && <div className="text-[11px] text-gray-400 mt-0.5">Printed {info.count} times so far</div>}
          </div>

          <p className="mt-4 text-sm text-gray-700 dark:text-gray-300">Are you sure you want to print it again?</p>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={() => close(false)} className="flex-1 h-11 rounded-xl border border-gray-300 dark:border-white/15 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancel</button>
          <button onClick={() => close(true)} className="flex-1 h-11 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 inline-flex items-center justify-center gap-2">
            <Printer size={16} /> Print Again
          </button>
        </div>
      </div>
    </div>
  )
}
