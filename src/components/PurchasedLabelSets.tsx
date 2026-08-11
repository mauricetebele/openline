'use client'
import { useMemo, useState } from 'react'
import { Printer, Ban, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { openLabel } from '@/lib/print-labels'

export interface PackageInfo { weightValue?: number; weightUnit?: string; length?: number; width?: number; height?: number; dimUnit?: string }
export interface PurchasedLabel {
  id: string; labelSetId: string; carrier: string; serviceLabel: string | null; serviceCode: string | null
  trackingNumber: string; pieceNumber: number; pieceCount: number; labelData: string; labelFormat: string
  packageInfo?: PackageInfo | null
  shipmentCost: number | null; currency: string | null; createdAt: string; voided: boolean
}

const money = (n: number | null, cur?: string | null) => (n != null ? `${!cur || cur === 'USD' ? '$' : cur + ' '}${n.toFixed(2)}` : '—')

function pkgLabel(p?: PackageInfo | null): string {
  if (!p) return ''
  const wu = p.weightUnit === 'OZS' ? 'oz' : 'lb'
  const w = p.weightValue != null ? `${p.weightValue} ${wu}` : ''
  const dims = p.length && p.width && p.height ? `${p.length}×${p.width}×${p.height} ${(p.dimUnit ?? 'IN').toLowerCase()}` : ''
  return [w, dims].filter(Boolean).join(' · ')
}

export default function PurchasedLabelSets({ rmaId, labels, onChanged, canVoid = false }: {
  rmaId: string; labels: PurchasedLabel[]; onChanged: () => void; canVoid?: boolean
}) {
  const [voiding, setVoiding] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const sets = useMemo(() => {
    const m = new Map<string, PurchasedLabel[]>()
    for (const l of labels) { const a = m.get(l.labelSetId) ?? []; a.push(l); m.set(l.labelSetId, a) }
    return Array.from(m.values()).map(rows => rows.sort((a, b) => a.pieceNumber - b.pieceNumber))
  }, [labels])

  async function voidSet(labelSetId: string) {
    if (!confirm('Void this label set with the carrier? This cannot be undone.')) return
    setVoiding(labelSetId); setErr('')
    try {
      const res = await fetch(`/api/vendor-rma/${rmaId}/labels/void`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ labelSetId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Void failed')
      onChanged()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Void failed') }
    finally { setVoiding(null) }
  }

  if (sets.length === 0) return null
  return (
    <div className="space-y-2">
      {err && <p className="text-xs text-red-600">{err}</p>}
      {sets.map(rows => {
        const head = rows[0]
        return (
          <div key={head.labelSetId} className={clsx('rounded-md border px-3 py-2', head.voided ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white')}>
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-1">
              <span className="text-xs font-semibold text-gray-700">{head.carrier.toUpperCase()}</span>
              <span className="text-xs text-gray-500">{head.serviceLabel ?? head.serviceCode}</span>
              <span className="text-[11px] text-gray-400">{rows.length} pc</span>
              <span className="text-[11px] text-gray-400">{new Date(head.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              {head.voided && <span className="text-[10px] font-semibold text-red-500 uppercase">Voided</span>}
              <div className="flex-1" />
              <span className="text-xs font-medium text-gray-600">{money(head.shipmentCost, head.currency)}</span>
              {canVoid && !head.voided && (
                <button onClick={() => voidSet(head.labelSetId)} disabled={voiding === head.labelSetId}
                  className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-50">
                  {voiding === head.labelSetId ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />} Void
                </button>
              )}
            </div>
            <div className="space-y-1">
              {rows.map(pc => (
                <div key={pc.id} className={clsx('flex items-center gap-2 text-xs', head.voided && 'opacity-50 line-through')}>
                  <span className="text-gray-400 w-10 shrink-0">#{pc.pieceNumber}/{pc.pieceCount}</span>
                  <span className="font-mono text-gray-800">{pc.trackingNumber}</span>
                  {pkgLabel(pc.packageInfo) && <span className="text-gray-400">{pkgLabel(pc.packageInfo)}</span>}
                  <div className="flex-1" />
                  {!head.voided && <button onClick={() => openLabel(pc.labelData, pc.labelFormat)} className="inline-flex items-center gap-1 text-amazon-blue hover:underline"><Printer size={12} /> Print</button>}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
