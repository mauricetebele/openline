'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { Search, RefreshCcw, Truck, X, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { AmazonAccountDTO } from '@/types'

// ─── Badge color palette ──────────────────────────────────────────────────────
const BADGE_COLORS = [
  'bg-blue-100 text-blue-800',
  'bg-purple-100 text-purple-800',
  'bg-green-100 text-green-800',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800',
  'bg-cyan-100 text-cyan-800',
  'bg-indigo-100 text-indigo-800',
  'bg-teal-100 text-teal-800',
]

function templateBadgeClass(template: string, allTemplates: string[]): string {
  const idx = allTemplates.indexOf(template)
  return idx >= 0 ? BADGE_COLORS[idx % BADGE_COLORS.length] : 'bg-gray-100 text-gray-700'
}

function groupBadgeClass(group: string, allGroups: string[]): string {
  const idx = allGroups.indexOf(group)
  return idx >= 0 ? BADGE_COLORS[idx % BADGE_COLORS.length] : 'bg-gray-100 text-gray-700'
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SellerListing {
  id: string
  accountId: string
  sku: string
  asin: string | null
  productTitle: string | null
  shippingTemplate: string | null
  listingStatus: string | null
  groupName: string | null
  quantity: number
  price: string | null
  account: { sellerId: string; marketplaceName: string }
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface ListingsResponse {
  data: SellerListing[]
  pagination: Pagination
  templates: string[]
  statuses: string[]
  groups: string[]
}

interface SyncJob {
  id: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  totalFound: number
  totalUpserted: number
  errorMessage: string | null
}

interface BatchJob {
  id: string
  status: 'RUNNING' | 'COMPLETED' | 'FAILED'
  templateName: string
  totalSkus: number
  processed: number
  updated: number
  failedSkus: { sku: string; error: string }[]
  errorMessage: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiPost(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const json = await res.json()
      if (json.error) msg = `${msg}: ${json.error}`
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ShippingTemplateManager() {
  const [accounts, setAccounts] = useState<AmazonAccountDTO[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [accountsError, setAccountsError] = useState<string | null>(null)

  const [listings, setListings] = useState<SellerListing[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [templates, setTemplates] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [templateFilter, setTemplateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Bulk action
  const [bulkTemplate, setBulkTemplate] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  // Bulk group action
  const [bulkGroup, setBulkGroup] = useState('')
  const [assigningGroup, setAssigningGroup] = useState(false)
  const [assignGroupError, setAssignGroupError] = useState<string | null>(null)

  // Background template batch job
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null)
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync
  const [syncStatus, setSyncStatus] = useState<SyncJob | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── Load accounts ──────────────────────────────────────────────────────────
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
          setAccountsError('No Amazon accounts connected. Go to Connect Amazon to add one.')
          return
        }
        setAccounts(data)
        setSelectedAccountId(data[0].id)
      })
      .catch((err: Error) => {
        setAccountsError(err.message)
        console.error('[ShippingTemplateManager] accounts fetch failed:', err)
      })
  }, [])

  // ─── Fetch listings ─────────────────────────────────────────────────────────
  const fetchListings = useCallback(async (opts?: { resetPage?: boolean }) => {
    if (!selectedAccountId) return
    setLoading(true)
    const currentPage = opts?.resetPage ? 1 : page
    if (opts?.resetPage) setPage(1)

    try {
      const params = new URLSearchParams({
        accountId: selectedAccountId,
        page: String(currentPage),
        pageSize: String(pageSize),
      })
      if (search) params.set('search', search)
      if (templateFilter) params.set('template', templateFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (groupFilter) params.set('group', groupFilter)

      const res = await fetch(`/api/listings?${params}`)
      if (!res.ok) throw new Error(`Listings fetch failed: ${res.status}`)
      const body: ListingsResponse = await res.json()

      setListings(body.data)
      setPagination(body.pagination)
      setTemplates(body.templates)
      setStatuses(body.statuses)
      setGroups(body.groups ?? [])
      setSelected(new Set())
    } catch (err) {
      console.error('[ShippingTemplateManager] fetchListings:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, page, pageSize, search, templateFilter, statusFilter, groupFilter])

  useEffect(() => {
    fetchListings()
  }, [fetchListings])

  // Reset page when filters, account, or page size change
  useEffect(() => {
    setPage(1)
  }, [search, templateFilter, statusFilter, groupFilter, selectedAccountId, pageSize])

  // ─── Sync catalog ───────────────────────────────────────────────────────────
  async function startSync() {
    if (!selectedAccountId || syncing) return
    setSyncing(true)
    setSyncStatus(null)
    setSyncError(null)

    try {
      const { jobId } = await apiPost('/api/listings/sync', { accountId: selectedAccountId }) as { jobId: string }

      // Start polling every 5 s
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/listings/sync?jobId=${jobId}`)
          if (!res.ok) return
          const job: SyncJob = await res.json()
          setSyncStatus(job)

          if (job.status === 'COMPLETED' || job.status === 'FAILED') {
            if (pollRef.current) clearInterval(pollRef.current)
            setSyncing(false)
            if (job.status === 'FAILED') {
              setSyncError(job.errorMessage ?? 'Sync failed for unknown reason')
            } else {
              fetchListings({ resetPage: true })
            }
          }
        } catch {
          // transient poll errors — keep polling
        }
      }, 5_000)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[ShippingTemplateManager] startSync:', message)
      setSyncError(message)
      setSyncing(false)
    }
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (batchPollRef.current) clearInterval(batchPollRef.current)
    }
  }, [])

  // ─── Selection helpers ──────────────────────────────────────────────────────
  function toggleAll() {
    if (selected.size === listings.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(listings.map((l) => l.sku)))
    }
  }

  function toggleRow(sku: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      return next
    })
  }

  // ─── Bulk apply (background job) ────────────────────────────────────────────
  async function applyBulkTemplate() {
    if (!bulkTemplate || selected.size === 0 || applying) return
    setApplying(true)
    setApplyError(null)
    try {
      const result = await apiPost('/api/listings/update-template', {
        accountId: selectedAccountId,
        skus: Array.from(selected),
        templateName: bulkTemplate,
      }) as { jobId: string }

      // Show optimistic initial state immediately — poll will fill in real numbers
      setBatchJob({
        id: result.jobId,
        status: 'RUNNING',
        templateName: bulkTemplate,
        totalSkus: selected.size,
        processed: 0,
        updated: 0,
        failedSkus: [],
        errorMessage: null,
      })

      // Clear selection — job is now running in the background
      setSelected(new Set())
      setBulkTemplate('')

      // Poll every 3 s for progress updates
      if (batchPollRef.current) clearInterval(batchPollRef.current)
      batchPollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/listings/update-template?jobId=${result.jobId}`)
          if (!res.ok) return
          const job = await res.json() as BatchJob
          setBatchJob(job)
          if (job.status === 'COMPLETED' || job.status === 'FAILED') {
            clearInterval(batchPollRef.current!)
            batchPollRef.current = null
            if (job.status === 'COMPLETED') fetchListings()
          }
        } catch { /* transient — keep polling */ }
      }, 3_000)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setApplyError(message)
      console.error('[ShippingTemplateManager] applyBulkTemplate:', message)
    } finally {
      setApplying(false)
    }
  }

  // ─── Bulk assign group ───────────────────────────────────────────────────────
  async function assignBulkGroup(groupName: string | null) {
    setAssigningGroup(true)
    setAssignGroupError(null)
    try {
      await apiPost('/api/listings/assign-group', {
        accountId: selectedAccountId,
        skus: [...selected],
        groupName,
      })
      setSelected(new Set())
      setBulkGroup('')
      await fetchListings()
    } catch (err) {
      setAssignGroupError(err instanceof Error ? err.message : String(err))
    } finally {
      setAssigningGroup(false)
    }
  }

  // ─── Sync status text ────────────────────────────────────────────────────────
  function syncStatusText() {
    if (!syncStatus) return 'Syncing…'
    if (syncStatus.status === 'RUNNING') {
      return `Syncing… (${syncStatus.totalUpserted} imported so far)`
    }
    if (syncStatus.status === 'COMPLETED') {
      return `Synced ${syncStatus.totalUpserted} MFN listing${syncStatus.totalUpserted !== 1 ? 's' : ''}`
    }
    return 'Syncing…'
  }

  const allSelected = listings.length > 0 && selected.size === listings.length

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      {/* ── Accounts error banner ─────────────────────────────────────────────── */}
      {accountsError && (
        <div className="flex items-center gap-2 px-6 py-3 bg-red-50 border-b border-red-200 text-red-700 text-sm">
          <AlertCircle size={14} className="shrink-0" />
          {accountsError}
        </div>
      )}

      {/* ── Sync error banner ─────────────────────────────────────────────────── */}
      {syncError && (
        <div className="flex items-center justify-between gap-2 px-6 py-3 bg-red-50 border-b border-red-200 text-red-700 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" />
            <span><strong>Sync failed:</strong> {syncError}</span>
          </div>
          <button onClick={() => setSyncError(null)} className="text-red-400 hover:text-red-700">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Apply error banner ────────────────────────────────────────────────── */}
      {applyError && (
        <div className="flex items-center justify-between gap-2 px-6 py-3 bg-red-50 border-b border-red-200 text-red-700 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" />
            <span><strong>Template update failed:</strong> {applyError}</span>
          </div>
          <button onClick={() => setApplyError(null)} className="text-red-400 hover:text-red-700">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Assign group error banner ─────────────────────────────────────────── */}
      {assignGroupError && (
        <div className="flex items-center justify-between gap-2 px-6 py-3 bg-red-50 border-b border-red-200 text-red-700 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" />
            <span><strong>Group assign failed:</strong> {assignGroupError}</span>
          </div>
          <button onClick={() => setAssignGroupError(null)} className="text-red-400 hover:text-red-700">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Template batch job progress banner ───────────────────────────────── */}
      {batchJob && (
        <div className={clsx(
          'px-6 py-3 border-b text-sm',
          batchJob.status === 'RUNNING'   && 'bg-amber-50 border-amber-200 text-amber-800',
          batchJob.status === 'COMPLETED' && 'bg-green-50 border-green-200 text-green-800',
          batchJob.status === 'FAILED'    && 'bg-red-50 border-red-200 text-red-700',
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {batchJob.status === 'RUNNING' && (
                <RefreshCcw size={13} className="animate-spin shrink-0" />
              )}
              {batchJob.status === 'FAILED' && (
                <AlertCircle size={14} className="shrink-0" />
              )}
              <span>
                {batchJob.status === 'RUNNING' && (
                  <>
                    Applying <strong>&ldquo;{batchJob.templateName}&rdquo;</strong>
                    {' '}— {batchJob.processed} / {batchJob.totalSkus} SKUs…
                  </>
                )}
                {batchJob.status === 'COMPLETED' && (
                  <>
                    <strong>{batchJob.updated}</strong> of {batchJob.totalSkus} SKU{batchJob.totalSkus !== 1 ? 's' : ''} updated
                    {batchJob.failedSkus.length > 0 && (
                      <>, <strong>{batchJob.failedSkus.length}</strong> failed</>
                    )}
                  </>
                )}
                {batchJob.status === 'FAILED' && (
                  <><strong>Template update failed:</strong> {batchJob.errorMessage}</>
                )}
              </span>
            </div>
            {batchJob.status !== 'RUNNING' && (
              <button
                onClick={() => setBatchJob(null)}
                className="text-gray-400 hover:text-gray-700 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {batchJob.status === 'RUNNING' && (
            <div className="mt-2 h-1 rounded-full bg-amber-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-500 transition-[width] duration-500"
                style={{ width: `${batchJob.totalSkus > 0 ? Math.round((batchJob.processed / batchJob.totalSkus) * 100) : 0}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b bg-gray-50">
        {/* Account selector */}
        <select
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          disabled={accounts.length === 0}
          className="h-9 rounded-md border border-gray-300 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {accounts.length === 0 && <option value="">No accounts</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.marketplaceName} — {a.sellerId}
            </option>
          ))}
        </select>

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search SKU, ASIN, title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8 pr-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-60"
          />
        </div>

        {/* Template filter */}
        <select
          value={templateFilter}
          onChange={(e) => setTemplateFilter(e.target.value)}
          className="h-9 rounded-md border border-gray-300 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All templates</option>
          {templates.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border border-gray-300 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Group filter */}
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="h-9 rounded-md border border-gray-300 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All groups</option>
          <option value="__none__">No group assigned</option>
          {groups.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>

        <div className="flex-1" />

        {/* Sync status */}
        {syncing && (
          <span className="text-sm text-gray-500 flex items-center gap-1.5">
            <RefreshCcw size={13} className="animate-spin" />
            {syncStatusText()}
          </span>
        )}
        {!syncing && syncStatus?.status === 'COMPLETED' && (
          <span className="text-sm text-green-600">{syncStatusText()}</span>
        )}

        {/* Sync button */}
        <button
          onClick={startSync}
          disabled={syncing || !selectedAccountId}
          className={clsx(
            'flex items-center gap-2 h-9 px-4 rounded-md text-sm font-medium transition-colors',
            syncing || !selectedAccountId
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-amazon-blue text-white hover:bg-blue-700',
          )}
        >
          <Truck size={14} />
          {syncing ? 'Syncing…' : 'Sync Catalog'}
        </button>
      </div>

      {/* ── Bulk action bar ──────────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="flex flex-col gap-0 bg-blue-50 border-b border-blue-200">
          {/* Row 1: template assignment */}
          <div className="flex items-center gap-3 px-6 py-2.5">
            <span className="text-sm font-medium text-blue-800">
              {selected.size} listing{selected.size !== 1 ? 's' : ''} selected
            </span>
            <input
              list="bulk-template-list"
              value={bulkTemplate}
              onChange={(e) => setBulkTemplate(e.target.value)}
              placeholder="Type or choose template…"
              className="h-8 rounded-md border border-blue-300 px-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
            />
            <datalist id="bulk-template-list">
              {templates.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <button
              onClick={applyBulkTemplate}
              disabled={!bulkTemplate || applying}
              className={clsx(
                'h-8 px-4 rounded-md text-sm font-medium transition-colors',
                !bulkTemplate || applying
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700',
              )}
            >
              {applying ? 'Applying…' : `Apply to ${selected.size} SKU${selected.size !== 1 ? 's' : ''}`}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto p-1 text-gray-400 hover:text-gray-700 transition-colors"
              title="Dismiss selection"
            >
              <X size={14} />
            </button>
          </div>
          {/* Row 2: group assignment */}
          <div className="flex items-center gap-3 px-6 py-2 border-t border-blue-100">
            <span className="text-sm text-blue-700 shrink-0">Group:</span>
            <input
              list="groups-datalist"
              value={bulkGroup}
              onChange={(e) => setBulkGroup(e.target.value)}
              placeholder="Type or choose group…"
              className="h-8 rounded-md border border-blue-300 px-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
            />
            <datalist id="groups-datalist">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <button
              onClick={() => assignBulkGroup(bulkGroup)}
              disabled={!bulkGroup || assigningGroup}
              className={clsx(
                'h-8 px-4 rounded-md text-sm font-medium transition-colors',
                !bulkGroup || assigningGroup
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700',
              )}
            >
              {assigningGroup ? 'Assigning…' : 'Assign Group'}
            </button>
            <button
              onClick={() => assignBulkGroup(null)}
              disabled={assigningGroup}
              className="text-sm text-blue-600 hover:text-blue-800 underline disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Remove from Group
            </button>
          </div>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 border-b z-10">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">SKU</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">ASIN</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">Product Title</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">Group</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">Current Template</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-600 whitespace-nowrap">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && listings.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
                  <p className="text-gray-500 text-sm">
                    No MFN listings found. Click <strong>Sync Catalog</strong> to import from Amazon.
                  </p>
                </td>
              </tr>
            )}
            {!loading && listings.map((listing) => {
              const isSelected = selected.has(listing.sku)
              return (
                <tr
                  key={listing.id}
                  onClick={() => toggleRow(listing.sku)}
                  className={clsx(
                    'cursor-pointer transition-colors',
                    isSelected ? 'bg-blue-50' : 'hover:bg-gray-50',
                  )}
                >
                  <td className="px-4 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(listing.sku)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-800 whitespace-nowrap">
                    {listing.sku}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                    {listing.asin ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-xs truncate" title={listing.productTitle ?? ''}>
                    {listing.productTitle ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {listing.listingStatus ? (
                      <span className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        listing.listingStatus === 'Active'
                          ? 'bg-green-100 text-green-800'
                          : listing.listingStatus === 'Inactive'
                          ? 'bg-gray-100 text-gray-600'
                          : 'bg-yellow-100 text-yellow-800',
                      )}>
                        {listing.listingStatus}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {listing.groupName ? (
                      <span className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        groupBadgeClass(listing.groupName, groups),
                      )}>
                        {listing.groupName}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {listing.shippingTemplate ? (
                      <span className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        templateBadgeClass(listing.shippingTemplate, templates),
                      )}>
                        {listing.shippingTemplate}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                    {listing.quantity}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────────── */}
      {(pagination.totalPages > 1 || pagination.total > 0) && (
        <div className="flex items-center justify-between px-6 py-3 border-t bg-white text-sm text-gray-600">
          <div className="flex items-center gap-3">
            <span>{pagination.total} listing{pagination.total !== 1 ? 's' : ''} total</span>
            <label className="flex items-center gap-1.5">
              <span className="text-gray-400">Rows:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="h-7 rounded border border-gray-300 px-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {[50, 100, 500, 1000, 5000].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} />
              </button>
              <span>Page {pagination.page} of {pagination.totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
