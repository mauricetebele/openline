'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { MessageSquare, ChevronRight, Search, X, Send, FolderOpen } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/context/AuthContext'

// ─── Types ────────────────────────────────────────────────────────────────────

type CaseStatus = 'UNRESOLVED' | 'RESOLVED'

interface CaseSummary {
  id: string
  caseNumber: number
  title: string
  description: string | null
  status: CaseStatus
  marketplaceCaseIds: string[]
  createdBy: { id: string; name: string }
  assignedTo: { id: string; name: string } | null
  createdAt: string
  updatedAt: string
  _count: { messages: number }
}

interface CaseMessage {
  id: string
  caseId: string
  authorId: string
  author: { id: string; name: string }
  body: string
  createdAt: string
}

interface CaseDetail extends CaseSummary {
  messages: CaseMessage[]
}

interface UserOption {
  id: string
  name: string
  email: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function padCaseNumber(n: number) {
  return String(n).padStart(4, '0')
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={clsx(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      status === 'UNRESOLVED' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700',
    )}>
      {status === 'UNRESOLVED' ? 'Unresolved' : 'Resolved'}
    </span>
  )
}

function AvatarInitial({ name }: { name: string }) {
  const initial = name?.[0]?.toUpperCase() ?? '?'
  return (
    <div className="w-8 h-8 rounded-full bg-amazon-blue flex items-center justify-center text-white text-xs font-bold shrink-0">
      {initial}
    </div>
  )
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

interface CreateModalProps {
  users: UserOption[]
  onClose: () => void
  onCreate: (c: CaseSummary) => void
}

function CreateModal({ users, onClose, onCreate }: CreateModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedToId, setAssignedToId] = useState('')
  const [marketplaceCaseIdsInput, setMarketplaceCaseIdsInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  async function submit() {
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError('')
    try {
      const marketplaceCaseIds = marketplaceCaseIdsInput
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || null, assignedToId: assignedToId || null, marketplaceCaseIds }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      const newCase: CaseSummary = await res.json()
      onCreate(newCase)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create case')
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onKeyDown={handleKeyDown}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">New Case</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={18} /></button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title <span className="text-red-500">*</span></label>
            <input
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Case title"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional description"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Marketplace Case IDs
              <span className="ml-1 text-xs text-gray-400 font-normal">(comma-separated)</span>
            </label>
            <input
              value={marketplaceCaseIdsInput}
              onChange={e => setMarketplaceCaseIdsInput(e.target.value)}
              placeholder="e.g. 123-456-789, 987-654-321"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Assign To</label>
            <select
              value={assignedToId}
              onChange={e => setAssignedToId(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            >
              <option value="">— Unassigned —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 text-sm bg-amazon-blue text-white rounded-lg hover:bg-amazon-blue/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail Slide-over ────────────────────────────────────────────────────────

interface DetailPanelProps {
  caseDetail: CaseDetail
  users: UserOption[]
  currentUserId: string
  onClose: () => void
  onUpdated: (updated: CaseDetail) => void
}

function DetailPanel({ caseDetail, users, currentUserId, onClose, onUpdated }: DetailPanelProps) {
  const [title, setTitle] = useState(caseDetail.title)
  const [description, setDescription] = useState(caseDetail.description ?? '')
  const [assignedToId, setAssignedToId] = useState(caseDetail.assignedTo?.id ?? '')
  const [marketplaceCaseIdsInput, setMarketplaceCaseIdsInput] = useState(
    (caseDetail.marketplaceCaseIds ?? []).join(', '),
  )
  const [marketplaceDirty, setMarketplaceDirty] = useState(false)
  const [savingMarketplace, setSavingMarketplace] = useState(false)
  const [messages, setMessages] = useState<CaseMessage[]>(caseDetail.messages)
  const [compose, setCompose] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages])

  async function patch(data: Record<string, unknown>) {
    const res = await fetch(`/api/cases/${caseDetail.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) return
    const updated: CaseDetail = await res.json()
    onUpdated(updated)
    return updated
  }

  async function handleTitleBlur() {
    if (title.trim() === caseDetail.title) return
    if (!title.trim()) { setTitle(caseDetail.title); return }
    await patch({ title: title.trim() })
  }

  async function handleDescriptionBlur() {
    const val = description.trim() || null
    if (val === caseDetail.description) return
    await patch({ description: val })
  }

  async function handleSaveMarketplaceCaseIds() {
    setSavingMarketplace(true)
    const ids = marketplaceCaseIdsInput
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    await patch({ marketplaceCaseIds: ids })
    setMarketplaceDirty(false)
    setSavingMarketplace(false)
  }

  async function handleAssignedChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    setAssignedToId(val)
    await patch({ assignedToId: val || null })
  }

  async function handleToggleStatus() {
    const newStatus: CaseStatus = caseDetail.status === 'UNRESOLVED' ? 'RESOLVED' : 'UNRESOLVED'
    await patch({ status: newStatus })
  }

  async function handleSendMessage() {
    if (!compose.trim()) return
    setSendingMsg(true)
    try {
      const res = await fetch(`/api/cases/${caseDetail.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: compose.trim() }),
      })
      if (!res.ok) return
      const newMsg: CaseMessage = await res.json()
      setMessages(prev => [...prev, newMsg])
      setCompose('')
      // Update message count on the parent list
      onUpdated({ ...caseDetail, messages: [...messages, newMsg], _count: { messages: messages.length + 1 } })
    } finally {
      setSendingMsg(false)
    }
  }

  function handleComposeKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-[600px] bg-white dark:bg-gray-900 shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-gray-500 dark:text-gray-400">#{padCaseNumber(caseDetail.caseNumber)}</span>
            <StatusBadge status={caseDetail.status} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleStatus}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                caseDetail.status === 'UNRESOLVED'
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200',
              )}
            >
              {caseDetail.status === 'UNRESOLVED' ? 'Mark Resolved' : 'Reopen'}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"><X size={18} /></button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              rows={4}
              placeholder="No description"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
            />
          </div>

          {/* Marketplace Case IDs */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Marketplace Case IDs
                <span className="ml-1 text-[10px] font-normal normal-case">(comma-separated)</span>
              </label>
              {marketplaceDirty && (
                <button
                  onClick={handleSaveMarketplaceCaseIds}
                  disabled={savingMarketplace}
                  className="text-xs text-amazon-blue hover:underline disabled:opacity-50"
                >
                  {savingMarketplace ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
            <input
              value={marketplaceCaseIdsInput}
              onChange={e => { setMarketplaceCaseIdsInput(e.target.value); setMarketplaceDirty(true) }}
              placeholder="e.g. 123-456-789, 987-654-321"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
            {/* Display as pills when saved */}
            {(caseDetail.marketplaceCaseIds ?? []).length > 0 && !marketplaceDirty && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(caseDetail.marketplaceCaseIds ?? []).map(id => (
                  <span key={id} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-full font-mono">
                    {id}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Assigned To */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Assigned To</label>
            <select
              value={assignedToId}
              onChange={handleAssignedChange}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            >
              <option value="">— Unassigned —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Message Thread */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Messages ({messages.length})
            </label>

            <div
              ref={threadRef}
              className="space-y-3 max-h-[280px] overflow-y-auto pr-1 mb-3"
            >
              {messages.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 italic">No messages yet.</p>
              )}
              {messages.map(msg => (
                <div key={msg.id} className="flex gap-3">
                  <AvatarInitial name={msg.author.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{msg.author.name}</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatDateTime(msg.createdAt)}</span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap break-words">{msg.body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Compose */}
            <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
              <textarea
                value={compose}
                onChange={e => setCompose(e.target.value)}
                onKeyDown={handleComposeKeyDown}
                rows={3}
                placeholder="Write a message… (Cmd+Enter to send)"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none resize-none"
              />
              <div className="flex justify-end px-3 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleSendMessage}
                  disabled={sendingMsg || !compose.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amazon-blue text-white text-xs rounded-lg hover:bg-amazon-blue/90 disabled:opacity-50 transition-colors"
                >
                  <Send size={12} />
                  {sendingMsg ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>

          {/* Meta */}
          <div className="text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-4">
            Created {formatDateTime(caseDetail.createdAt)} by {caseDetail.createdBy.name}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CaseManager() {
  const { user } = useAuth()
  const [cases, setCases] = useState<CaseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNRESOLVED' | 'RESOLVED'>('ALL')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [users, setUsers] = useState<UserOption[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearch(searchInput), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  // Load users for assignment dropdowns
  useEffect(() => {
    fetch('/api/admin/users')
      .then(r => r.json())
      .then(d => setUsers(d.data ?? []))
      .catch(() => {})
  }, [])

  // Load cases when filters change
  const loadCases = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (search) params.set('search', search)
      const res = await fetch(`/api/cases?${params}`)
      const data = await res.json()
      setCases(data.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search])

  useEffect(() => { loadCases() }, [loadCases])

  async function openDetail(c: CaseSummary) {
    const res = await fetch(`/api/cases/${c.id}`)
    const full: CaseDetail = await res.json()
    setDetail(full)
  }

  function handleCreated(newCase: CaseSummary) {
    setCases(prev => [newCase, ...prev])
    setShowCreate(false)
    // Open detail for newly created case
    openDetail(newCase)
  }

  function handleUpdated(updated: CaseDetail) {
    setDetail(updated)
    setCases(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
  }

  return (
    <div className="p-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FolderOpen size={22} className="text-amazon-blue" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Cases</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-amazon-blue text-white text-sm font-medium rounded-lg hover:bg-amazon-blue/90 transition-colors"
        >
          + New Case
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {/* Status pills */}
        <div className="flex gap-1">
          {(['ALL', 'UNRESOLVED', 'RESOLVED'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                statusFilter === s
                  ? 'bg-amazon-blue text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600',
              )}
            >
              {s === 'ALL' ? 'All' : s === 'UNRESOLVED' ? 'Unresolved' : 'Resolved'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="ml-auto relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search cases…"
            className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue w-[220px]"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
        ) : cases.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            {search || statusFilter !== 'ALL'
              ? 'No cases match your filters.'
              : 'No cases yet — click New Case to get started.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 text-left w-16">#</th>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left w-28">Status</th>
                <th className="px-4 py-3 text-left w-32">Assigned To</th>
                <th className="px-4 py-3 text-center w-20">Msgs</th>
                <th className="px-4 py-3 text-left w-40">Created</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {cases.map(c => (
                <tr
                  key={c.id}
                  onClick={() => openDetail(c)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {padCaseNumber(c.caseNumber)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white truncate max-w-[280px]">{c.title}</div>
                    {c.description && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[280px] mt-0.5">{c.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                    {c.assignedTo?.name ?? <span className="text-gray-400 italic">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="flex items-center justify-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <MessageSquare size={12} />
                      {c._count.messages}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    <div>{formatDate(c.createdAt)}</div>
                    <div className="text-gray-400 dark:text-gray-500 mt-0.5">{c.createdBy.name}</div>
                  </td>
                  <td className="px-2 py-3 text-gray-300 dark:text-gray-600">
                    <ChevronRight size={14} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <CreateModal
          users={users}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreated}
        />
      )}

      {/* Detail Slide-over */}
      {detail && (
        <DetailPanel
          caseDetail={detail}
          users={users}
          currentUserId={user?.uid ?? ''}
          onClose={() => setDetail(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  )
}
