'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Pencil, X, Check, ToggleLeft, ToggleRight } from 'lucide-react'
import { clsx } from 'clsx'

interface CostCode {
  id: string
  name: string
  amount: string
  isActive: boolean
  createdAt: string
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function CostCodeManager() {
  const [codes, setCodes] = useState<CostCode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Add form
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [adding, setAdding] = useState(false)

  // Edit state
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAmount, setEditAmount] = useState('')

  const fetchCodes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cost-codes')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setCodes(data.data ?? [])
    } catch {
      setError('Failed to load cost codes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCodes() }, [fetchCodes])

  async function handleAdd() {
    if (!newName.trim() || !newAmount) return
    setAdding(true)
    setError('')
    try {
      const res = await fetch('/api/cost-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), amount: Number(newAmount) }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to add')
        return
      }
      setNewName('')
      setNewAmount('')
      fetchCodes()
    } catch {
      setError('Failed to add cost code')
    } finally {
      setAdding(false)
    }
  }

  async function handleUpdate(id: string) {
    setError('')
    try {
      const res = await fetch(`/api/cost-codes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), amount: Number(editAmount) }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to update')
        return
      }
      setEditId(null)
      fetchCodes()
    } catch {
      setError('Failed to update cost code')
    }
  }

  async function toggleActive(code: CostCode) {
    setError('')
    try {
      await fetch(`/api/cost-codes/${code.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !code.isActive }),
      })
      fetchCodes()
    } catch {
      setError('Failed to toggle status')
    }
  }

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <th className="px-4 py-2.5 text-left font-semibold text-gray-700 dark:text-gray-300">Name</th>
              <th className="px-4 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300">Amount ($/unit)</th>
              <th className="px-4 py-2.5 text-center font-semibold text-gray-700 dark:text-gray-300">Status</th>
              <th className="px-4 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* Add row */}
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-blue-50/50 dark:bg-blue-900/10">
              <td className="px-4 py-2">
                <input
                  type="text"
                  placeholder="Cost code name..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  className="w-full px-2 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </td>
              <td className="px-4 py-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  className="w-full px-2 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-right"
                />
              </td>
              <td />
              <td className="px-4 py-2 text-right">
                <button
                  onClick={handleAdd}
                  disabled={adding || !newName.trim() || !newAmount}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amazon-blue text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  <Plus size={12} /> Add
                </button>
              </td>
            </tr>

            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : codes.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No cost codes yet. Add one above.</td></tr>
            ) : (
              codes.map((code) => (
                <tr key={code.id} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
                  {editId === code.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleUpdate(code.id)}
                          className="w-full px-2 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          autoFocus
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleUpdate(code.id)}
                          className="w-full px-2 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-right"
                        />
                      </td>
                      <td />
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => handleUpdate(code.id)}
                            className="p-1.5 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                            title="Save"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => setEditId(null)}
                            className="p-1.5 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                            title="Cancel"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{code.name}</td>
                      <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{fmt.format(Number(code.amount))}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={clsx(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold',
                          code.isActive
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
                        )}>
                          {code.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => { setEditId(code.id); setEditName(code.name); setEditAmount(String(code.amount)) }}
                            className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                            title="Edit"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => toggleActive(code)}
                            className={clsx(
                              'p-1.5 rounded',
                              code.isActive
                                ? 'text-emerald-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                                : 'text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
                            )}
                            title={code.isActive ? 'Deactivate' : 'Activate'}
                          >
                            {code.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
