'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Search, RotateCcw } from 'lucide-react'
import { clsx } from 'clsx'
import CreateFbaReturnModal from './CreateFbaReturnModal'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FbaReturnReceipt {
  id: string
  receiptNumber: string
  serialNumber: string
  sku: string
  gradeId: string | null
  previousGradeId: string | null
  note: string | null
  receivedAt: string
  product: { sku: string; description: string }
  grade: { id: string; grade: string } | null
  location: { name: string; warehouse: { name: string } }
  fbaShipment: { shipmentNumber: string | null } | null
  receivedBy: { name: string } | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FbaReturnsTab() {
  const [receipts, setReceipts] = useState<FbaReturnReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)

  const fetchReceipts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/api/fba-return-receipts?${params}`)
      const json = await res.json()
      setReceipts(json.data ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [search])

  useEffect(() => { fetchReceipts() }, [fetchReceipts])

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receipt #, serial, SKU..."
            className="h-9 pl-8 pr-3 w-64 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>

        {receipts.length > 0 && (
          <span className="text-xs text-gray-400">
            {receipts.length} receipt{receipts.length !== 1 ? 's' : ''}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
        >
          <Plus size={14} /> New FBA Return
        </button>
      </div>

      {/* Table or empty state */}
      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
      ) : receipts.length === 0 ? (
        <div className="py-20 text-center">
          <RotateCcw size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">
            {search ? 'No FBA returns match your search' : 'No FBA returns yet'}
          </p>
          {!search && (
            <button onClick={() => setShowModal(true)} className="mt-3 text-sm text-amazon-blue hover:underline">
              Receive your first FBA return
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Receipt #</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Serial #</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">SKU</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Grade</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Shipment #</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Location</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Received By</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Date</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r, i) => (
                <tr
                  key={r.id}
                  className={clsx(
                    'border-b border-gray-200 dark:border-gray-700 last:border-0 align-middle',
                    i % 2 === 0
                      ? 'bg-white dark:bg-gray-900'
                      : 'bg-gray-50 dark:bg-gray-800/50',
                  )}
                >
                  <td className="px-3 py-1.5 font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">{r.receiptNumber}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-900 dark:text-gray-200">{r.serialNumber}</td>
                  <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{r.sku}</td>
                  <td className="px-3 py-1.5">
                    {r.grade ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[10px] font-medium">
                          {r.grade.grade}
                        </span>
                        {r.previousGradeId && r.previousGradeId !== r.gradeId && (
                          <span className="text-[10px] text-gray-400">(regraded)</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-gray-500 dark:text-gray-400">
                    {r.fbaShipment?.shipmentNumber ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {r.location.warehouse.name} / {r.location.name}
                  </td>
                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">{r.receivedBy?.name ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {new Date(r.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <CreateFbaReturnModal
          onClose={() => setShowModal(false)}
          onCreated={fetchReceipts}
        />
      )}
    </>
  )
}
