'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { FolderOpen, Plus, MessageSquare, X, Send, Search, CheckCircle2, UserPlus, Trash2, Paperclip, Download, FileText } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/context/AuthContext'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

type CaseStatus = 'UNRESOLVED' | 'RESOLVED'

interface TaggedUser {
  id: string
  userId: string
  user: { id: string; name: string; email?: string }
}

interface CaseSummary {
  id: string
  caseNumber: number
  title: string
  description: string | null
  status: CaseStatus
  createdAt: string
  createdBy: { id: string; name: string }
  taggedUsers: TaggedUser[]
  _count: { messages: number }
}

interface Attachment {
  url: string
  filename: string
  contentType: string
  size: number
}

interface CaseMessageItem {
  id: string
  caseId: string
  authorId: string
  author: { id: string; name: string }
  body: string
  attachments?: Attachment[] | null
  createdAt: string
}

type MktCaseIdStatus = 'AWAITING_RESPONSE' | 'DEAD' | null

interface MktCaseId {
  id: string
  status: MktCaseIdStatus
}

interface CaseDetail extends CaseSummary {
  resolvedAt: string | null
  resolvedBy: { id: string; name: string } | null
  resolutionNote: string | null
  marketplaceCaseIds: MktCaseId[] | null
  updatedAt: string
  messages: CaseMessageItem[]
}

interface UserOption {
  id: string
  name: string
  email: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isImage(contentType: string) {
  return contentType.startsWith('image/')
}

function AvatarInitial({ name }: { name: string }) {
  const initial = name?.[0]?.toUpperCase() ?? '?'
  return (
    <div className="w-7 h-7 rounded-full bg-amazon-blue flex items-center justify-center text-white text-[10px] font-bold shrink-0">
      {initial}
    </div>
  )
}

// Parse @[Name](userId) mentions in message body and render as highlighted spans
const MENTION_PATTERN = /@\[([^\]]+)\]\(([^)]+)\)/
const hasMentions = (body: string) => MENTION_PATTERN.test(body)

function renderMessageBody(body: string) {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  const re = new RegExp(MENTION_PATTERN.source, 'g')
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push(body.slice(lastIndex, match.index))
    }
    const name = match[1]
    parts.push(
      <span key={match.index} className="inline-flex items-center px-1 py-0.5 rounded bg-amazon-blue/10 text-amazon-blue dark:bg-amazon-blue/20 dark:text-blue-300 font-semibold text-[13px]">
        @{name}
      </span>,
    )
    lastIndex = re.lastIndex
  }
  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex))
  }
  return parts.length > 0 ? parts : body
}

// Extract mentioned user IDs from the compose text
function extractMentionedUserIds(text: string): string[] {
  const ids: string[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(MENTION_PATTERN.source, 'g')
  while ((match = re.exec(text)) !== null) {
    ids.push(match[2])
  }
  return ids
}

const STATUS_BADGE = {
  UNRESOLVED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  RESOLVED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
} as const

// ─── Create Modal ─────────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void
  onCreate: (c: CaseSummary) => void
}

function CreateModal({ onClose, onCreate }: CreateModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [allUsers, setAllUsers] = useState<UserOption[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  useEffect(() => {
    fetch('/api/cases/users')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.data) setAllUsers(d.data.map((u: UserOption) => ({ id: u.id, name: u.name, email: u.email })))
      })
      .catch(() => {})
  }, [])

  function toggleUser(uid: string) {
    setSelectedUserIds(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  async function submit() {
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          taggedUserIds: Array.from(selectedUserIds),
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      const newCase: CaseSummary = await res.json()
      toast.success('Case created')
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
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
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
              placeholder="Optional details"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tag Users</label>
            <div className="border border-gray-300 dark:border-gray-600 rounded-lg max-h-40 overflow-y-auto p-2 space-y-1">
              {allUsers.length === 0 && <p className="text-xs text-gray-400">Loading users…</p>}
              {allUsers.map(u => (
                <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedUserIds.has(u.id)}
                    onChange={() => toggleUser(u.id)}
                    className="rounded border-gray-300 dark:border-gray-600 text-amazon-blue focus:ring-amazon-blue"
                  />
                  <span className="text-sm text-gray-800 dark:text-gray-200">{u.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{u.email}</span>
                </label>
              ))}
            </div>
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
            {saving ? 'Creating…' : 'Create Case'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Resolve Modal ────────────────────────────────────────────────────────────

interface ResolveModalProps {
  onClose: () => void
  onResolve: (note: string) => void
  saving: boolean
}

function ResolveModal({ onClose, onResolve, saving }: ResolveModalProps) {
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { noteRef.current?.focus() }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onKeyDown={handleKeyDown}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Resolve Case</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Provide a resolution note explaining how this case was resolved.</p>
        <textarea
          ref={noteRef}
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={4}
          placeholder="Resolution note…"
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
        />
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onResolve(note)}
            disabled={saving || !note.trim()}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Resolving…' : 'Resolve'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Users Modal ──────────────────────────────────────────────────────────

interface AddUsersModalProps {
  existingUserIds: Set<string>
  onClose: () => void
  onAdd: (userIds: string[]) => void
  saving: boolean
}

function AddUsersModal({ existingUserIds, onClose, onAdd, saving }: AddUsersModalProps) {
  const [allUsers, setAllUsers] = useState<UserOption[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/cases/users')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.data) setAllUsers(d.data.filter((u: UserOption) => !existingUserIds.has(u.id)))
      })
      .catch(() => {})
  }, [existingUserIds])

  function toggleUser(uid: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Add Tagged Users</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={18} /></button>
        </div>
        <div className="border border-gray-300 dark:border-gray-600 rounded-lg max-h-48 overflow-y-auto p-2 space-y-1">
          {allUsers.length === 0 && <p className="text-xs text-gray-400">No more users to add.</p>}
          {allUsers.map(u => (
            <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(u.id)}
                onChange={() => toggleUser(u.id)}
                className="rounded border-gray-300 dark:border-gray-600 text-amazon-blue focus:ring-amazon-blue"
              />
              <span className="text-sm text-gray-800 dark:text-gray-200">{u.name}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onAdd(Array.from(selected))}
            disabled={saving || selected.size === 0}
            className="px-4 py-2 text-sm bg-amazon-blue text-white rounded-lg hover:bg-amazon-blue/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail Slide-over ────────────────────────────────────────────────────────

interface DetailPanelProps {
  caseDetail: CaseDetail
  onClose: () => void
  onUpdated: (updated: CaseDetail) => void
  onDeleted: () => void
  currentUserId: string
  currentUserRole: string
}

// Normalize marketplace case IDs — handles legacy plain strings and new object format
function normalizeMktCaseIds(raw: unknown): MktCaseId[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => {
    if (typeof item === 'string') return { id: item, status: null as MktCaseIdStatus }
    if (item && typeof item === 'object' && typeof item.id === 'string') return item as MktCaseId
    return null
  }).filter((x): x is MktCaseId => x !== null)
}

function DetailPanel({ caseDetail, onClose, onUpdated, onDeleted, currentUserId, currentUserRole }: DetailPanelProps) {
  const [compose, setCompose] = useState('')
  const [messages, setMessages] = useState<CaseMessageItem[]>(caseDetail.messages)
  const [sendingMsg, setSendingMsg] = useState(false)
  const [sendStatus, setSendStatus] = useState<'idle' | 'uploading' | 'sending'>('idle')
  const [showResolve, setShowResolve] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [showAddUsers, setShowAddUsers] = useState(false)
  const [addingUsers, setAddingUsers] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [mktCaseIds, setMktCaseIds] = useState<MktCaseId[]>(normalizeMktCaseIds(caseDetail.marketplaceCaseIds))
  const [mktInput, setMktInput] = useState('')
  const [savingMktIds, setSavingMktIds] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const composeRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync messages from prop when caseDetail changes (e.g. resolve updates the full detail)
  useEffect(() => { setMessages(caseDetail.messages) }, [caseDetail.messages])
  useEffect(() => { setMktCaseIds(normalizeMktCaseIds(caseDetail.marketplaceCaseIds)) }, [caseDetail.marketplaceCaseIds])

  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(0) // cursor position of the '@'
  const [mentionIdx, setMentionIdx] = useState(0) // keyboard highlight index
  // Track mentions by the display text "@Name" → userId mapping
  const mentionMapRef = useRef<Map<string, string>>(new Map())

  const isCreator = caseDetail.createdBy.id === currentUserId

  // Build mentionable users list: tagged users + creator (exclude self)
  const mentionableUsers: { id: string; name: string }[] = []
  const seen = new Set<string>()
  for (const tu of caseDetail.taggedUsers) {
    if (tu.userId !== currentUserId && !seen.has(tu.userId)) {
      seen.add(tu.userId)
      mentionableUsers.push({ id: tu.userId, name: tu.user.name })
    }
  }
  if (caseDetail.createdBy.id !== currentUserId && !seen.has(caseDetail.createdBy.id)) {
    mentionableUsers.push({ id: caseDetail.createdBy.id, name: caseDetail.createdBy.name })
  }

  const filteredMentions = mentionQuery !== null
    ? mentionableUsers.filter(u => u.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
    : []

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages])

  function insertMention(user: { id: string; name: string }) {
    const before = compose.slice(0, mentionStart)
    const cursorPos = composeRef.current?.selectionStart ?? compose.length
    const after = compose.slice(cursorPos)
    // Insert clean "@Name " into the textarea (no userId visible)
    const displayMention = `@${user.name} `
    const newText = before + displayMention + after
    setCompose(newText)
    setMentionQuery(null)
    // Track this mention for send time
    mentionMapRef.current.set(user.name, user.id)
    requestAnimationFrame(() => {
      const pos = before.length + displayMention.length
      composeRef.current?.setSelectionRange(pos, pos)
      composeRef.current?.focus()
    })
  }

  // At send time, convert "@Name" back to "@[Name](userId)" for storage
  function buildMessageBody(text: string): { body: string; mentionedUserIds: string[] } {
    let body = text
    const mentionedUserIds: string[] = []
    // Also match any mentionable user name in case the map missed it
    for (const u of mentionableUsers) {
      const displayPattern = `@${u.name}`
      if (body.includes(displayPattern)) {
        body = body.split(displayPattern).join(`@[${u.name}](${u.id})`)
        mentionedUserIds.push(u.id)
      }
    }
    return { body, mentionedUserIds }
  }

  function handleComposeChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setCompose(val)

    const cursor = e.target.selectionStart ?? val.length
    // Walk backward from cursor to find an unmatched '@'
    let atPos = -1
    for (let i = cursor - 1; i >= 0; i--) {
      if (val[i] === '@') { atPos = i; break }
      if (val[i] === ' ' || val[i] === '\n') break
    }

    if (atPos >= 0 && (atPos === 0 || val[atPos - 1] === ' ' || val[atPos - 1] === '\n')) {
      const query = val.slice(atPos + 1, cursor)
      if (!query.includes('[')) {
        setMentionQuery(query)
        setMentionStart(atPos)
        setMentionIdx(0)
        return
      }
    }
    setMentionQuery(null)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setPendingFiles(prev => {
      const combined = [...prev, ...files]
      return combined.slice(0, 5) // max 5
    })
    e.target.value = '' // reset so same file can be re-selected
  }

  function removePendingFile(index: number) {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSendMessage() {
    const hasText = !!compose.trim()
    const hasFiles = pendingFiles.length > 0
    if (!hasText && !hasFiles) return

    setSendingMsg(true)
    setMentionQuery(null)

    try {
      // Upload pending files
      let attachments: Attachment[] = []
      if (hasFiles) {
        setSendStatus('uploading')
        const uploads = await Promise.all(
          pendingFiles.map(async (file) => {
            const fd = new FormData()
            fd.append('file', file)
            const res = await fetch('/api/cases/upload', { method: 'POST', body: fd })
            if (!res.ok) {
              const d = await res.json()
              throw new Error(d.error || `Failed to upload ${file.name}`)
            }
            return res.json() as Promise<Attachment>
          }),
        )
        attachments = uploads
      }

      setSendStatus('sending')
      const { body: finalBody, mentionedUserIds } = buildMessageBody(compose.trim())
      const res = await fetch(`/api/cases/${caseDetail.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: finalBody,
          mentionedUserIds,
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
      })
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Failed'); return }
      const newMsg: CaseMessageItem = await res.json()
      const updatedMessages = [...messages, newMsg]
      setMessages(updatedMessages)
      setCompose('')
      setPendingFiles([])
      mentionMapRef.current.clear()
      onUpdated({
        ...caseDetail,
        messages: updatedMessages,
        _count: { messages: updatedMessages.length },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSendingMsg(false)
      setSendStatus('idle')
    }
  }

  function handleComposeKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // If mention dropdown is open, handle arrow keys / Enter / Escape
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx(prev => Math.min(prev + 1, filteredMentions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx(prev => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(filteredMentions[mentionIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  async function handleResolve(note: string) {
    setResolving(true)
    try {
      const res = await fetch(`/api/cases/${caseDetail.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutionNote: note }),
      })
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Failed'); return }
      const updated: CaseDetail = await res.json()
      toast.success('Case resolved')
      onUpdated(updated)
      setShowResolve(false)
    } finally {
      setResolving(false)
    }
  }

  async function handleDeleteCase() {
    if (!confirm(`Delete Case #${caseDetail.caseNumber}? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/cases/${caseDetail.id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Failed to delete'); return }
      toast.success('Case deleted')
      onDeleted()
    } catch {
      toast.error('Failed to delete case')
    } finally {
      setDeleting(false)
    }
  }

  async function handleAddUsers(userIds: string[]) {
    setAddingUsers(true)
    try {
      const res = await fetch(`/api/cases/${caseDetail.id}/tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds }),
      })
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Failed'); return }
      const updated: CaseDetail = await res.json()
      toast.success('Users tagged')
      onUpdated(updated)
      setShowAddUsers(false)
    } finally {
      setAddingUsers(false)
    }
  }

  async function saveMktCaseIds(ids: MktCaseId[]) {
    setSavingMktIds(true)
    try {
      const res = await fetch(`/api/cases/${caseDetail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketplaceCaseIds: ids }),
      })
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Failed'); return }
      const updated: CaseDetail = await res.json()
      onUpdated(updated)
    } finally {
      setSavingMktIds(false)
    }
  }

  function handleAddMktId() {
    const val = mktInput.trim()
    if (!val || mktCaseIds.some(m => m.id === val)) { setMktInput(''); return }
    const next = [...mktCaseIds, { id: val, status: null as MktCaseIdStatus }]
    setMktCaseIds(next)
    setMktInput('')
    saveMktCaseIds(next)
  }

  function handleRemoveMktId(id: string) {
    const next = mktCaseIds.filter(m => m.id !== id)
    setMktCaseIds(next)
    saveMktCaseIds(next)
  }

  function handleToggleMktStatus(id: string, newStatus: MktCaseIdStatus) {
    const next = mktCaseIds.map(m =>
      m.id === id ? { ...m, status: m.status === newStatus ? null : newStatus } : m,
    )
    setMktCaseIds(next)
    saveMktCaseIds(next)
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />

      <div className="w-full max-w-[600px] bg-white dark:bg-gray-900 shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-gray-500 dark:text-gray-400">#{caseDetail.caseNumber}</span>
            <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', STATUS_BADGE[caseDetail.status])}>
              {caseDetail.status === 'UNRESOLVED' ? 'Unresolved' : 'Resolved'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {caseDetail.status === 'UNRESOLVED' && (
              <button
                onClick={() => setShowResolve(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 transition-colors"
              >
                <CheckCircle2 size={14} />
                Resolve
              </button>
            )}
            {currentUserRole === 'ADMIN' && (
              <button
                onClick={handleDeleteCase}
                disabled={deleting}
                className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 p-1 transition-colors disabled:opacity-50"
                title="Delete case"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"><X size={18} /></button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Resolution Banner */}
          {caseDetail.status === 'RESOLVED' && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
                <span className="text-sm font-semibold text-green-800 dark:text-green-300">
                  Resolved by {caseDetail.resolvedBy?.name}
                </span>
                {caseDetail.resolvedAt && (
                  <span className="text-xs text-green-600 dark:text-green-500 ml-auto">{formatDateTime(caseDetail.resolvedAt)}</span>
                )}
              </div>
              {caseDetail.resolutionNote && (
                <p className="text-sm text-green-700 dark:text-green-300 whitespace-pre-wrap">{caseDetail.resolutionNote}</p>
              )}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Title</label>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{caseDetail.title}</h2>
          </div>

          {/* Description */}
          {caseDetail.description && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Description</label>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{caseDetail.description}</p>
            </div>
          )}

          {/* Tagged Users */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Tagged Users</label>
              {isCreator && (
                <button
                  onClick={() => setShowAddUsers(true)}
                  className="text-amazon-blue hover:text-amazon-blue/80 transition-colors"
                  title="Add users"
                >
                  <UserPlus size={14} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {caseDetail.taggedUsers.map(tu => (
                <span key={tu.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300">
                  <AvatarInitial name={tu.user.name} />
                  {tu.user.name}
                </span>
              ))}
              {caseDetail.taggedUsers.length === 0 && (
                <p className="text-xs text-gray-400 italic">No tagged users</p>
              )}
            </div>
          </div>

          {/* Marketplace Case IDs */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Marketplace Case IDs</label>
            <div className="space-y-1.5 mb-2">
              {mktCaseIds.length === 0 && !savingMktIds && (
                <p className="text-xs text-gray-400 italic">None added</p>
              )}
              {mktCaseIds.map(m => (
                <div key={m.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <span className="text-xs font-mono text-gray-800 dark:text-gray-200 flex-1 min-w-0 truncate">{m.id}</span>
                  <button
                    type="button"
                    onClick={() => handleToggleMktStatus(m.id, 'AWAITING_RESPONSE')}
                    className={clsx(
                      'px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
                      m.status === 'AWAITING_RESPONSE'
                        ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700'
                        : 'bg-white dark:bg-gray-700 text-gray-400 border-gray-200 dark:border-gray-600 hover:border-amber-300 hover:text-amber-600',
                    )}
                  >
                    Awaiting Response
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleMktStatus(m.id, 'DEAD')}
                    className={clsx(
                      'px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
                      m.status === 'DEAD'
                        ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700'
                        : 'bg-white dark:bg-gray-700 text-gray-400 border-gray-200 dark:border-gray-600 hover:border-red-300 hover:text-red-600',
                    )}
                  >
                    Dead
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveMktId(m.id)}
                    className="text-gray-300 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors ml-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {savingMktIds && <span className="text-[10px] text-gray-400 ml-1">Saving…</span>}
            </div>
            <div className="flex gap-2">
              <input
                value={mktInput}
                onChange={e => setMktInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMktId() } }}
                placeholder="Add case ID…"
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue font-mono"
              />
              <button
                type="button"
                onClick={handleAddMktId}
                disabled={!mktInput.trim() || savingMktIds}
                className="px-3 py-1.5 text-xs bg-amazon-blue text-white rounded-lg hover:bg-amazon-blue/90 disabled:opacity-50 transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          {/* Message Thread */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Messages ({messages.length})
            </label>

            <div
              ref={threadRef}
              className="space-y-3 max-h-[320px] overflow-y-auto pr-1 mb-3"
            >
              {messages.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 italic">No messages yet.</p>
              )}
              {messages.map(m => {
                const msgHasMentions = hasMentions(m.body)
                const atts = (m.attachments ?? []) as Attachment[]
                return (
                  <div key={m.id} className={clsx('flex gap-3', msgHasMentions && 'bg-red-50/60 dark:bg-red-900/10 -mx-2 px-2 py-1.5 rounded-lg border-l-2 border-red-400')}>
                    <AvatarInitial name={m.author.name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{m.author.name}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">{relativeTime(m.createdAt)}</span>
                        {msgHasMentions && (
                          <span className="text-[10px] font-semibold text-red-500 dark:text-red-400">Attention Requested</span>
                        )}
                      </div>
                      {m.body && (
                        <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap break-words">{renderMessageBody(m.body)}</p>
                      )}
                      {atts.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {atts.map((att, i) =>
                            isImage(att.contentType) ? (
                              <a
                                key={i}
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group relative block w-32 h-24 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700"
                              >
                                <img src={att.url} alt={att.filename} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                  <Download size={18} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <span className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 bg-black/50 text-white text-[10px] truncate">{att.filename}</span>
                              </a>
                            ) : (
                              <a
                                key={i}
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors max-w-[220px]"
                              >
                                <FileText size={16} className="text-gray-400 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{att.filename}</p>
                                  <p className="text-[10px] text-gray-400">{formatFileSize(att.size)}</p>
                                </div>
                                <Download size={14} className="text-gray-400 shrink-0" />
                              </a>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Compose */}
            <div className="relative border border-gray-300 dark:border-gray-600 rounded-lg overflow-visible">
              {/* @mention dropdown */}
              {mentionQuery !== null && filteredMentions.length > 0 && (
                <div className="absolute bottom-full left-0 mb-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl py-1 z-50 max-h-40 overflow-y-auto">
                  {filteredMentions.map((u, i) => (
                    <button
                      key={u.id}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); insertMention(u) }}
                      className={clsx(
                        'flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors',
                        i === mentionIdx
                          ? 'bg-amazon-blue/10 text-amazon-blue dark:bg-amazon-blue/20 dark:text-blue-300'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
                      )}
                    >
                      <AvatarInitial name={u.name} />
                      {u.name}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                ref={composeRef}
                value={compose}
                onChange={handleComposeChange}
                onKeyDown={handleComposeKeyDown}
                rows={3}
                placeholder="Write a message… Type @ to mention (Cmd+Enter to send)"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none resize-none rounded-t-lg"
              />

              {/* Pending files preview strip */}
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 px-3 py-2 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
                  {pendingFiles.map((file, idx) => (
                    <div key={idx} className="relative group flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300">
                      {file.type.startsWith('image/') ? (
                        <img
                          src={URL.createObjectURL(file)}
                          alt={file.name}
                          className="w-8 h-8 rounded object-cover"
                        />
                      ) : (
                        <FileText size={14} className="text-gray-400 shrink-0" />
                      )}
                      <span className="max-w-[100px] truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removePendingFile(idx)}
                        className="ml-0.5 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 rounded-b-lg">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={pendingFiles.length >= 5 || sendingMsg}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 transition-colors"
                  title={pendingFiles.length >= 5 ? 'Max 5 files' : 'Attach files'}
                >
                  <Paperclip size={16} />
                </button>
                <button
                  onClick={handleSendMessage}
                  disabled={sendingMsg || (!compose.trim() && pendingFiles.length === 0)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amazon-blue text-white text-xs rounded-lg hover:bg-amazon-blue/90 disabled:opacity-50 transition-colors"
                >
                  <Send size={12} />
                  {sendStatus === 'uploading' ? 'Uploading…' : sendStatus === 'sending' ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>

          {/* Meta */}
          <div className="text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-4 space-y-1">
            <p>Created by {caseDetail.createdBy.name} on {formatDateTime(caseDetail.createdAt)}</p>
          </div>
        </div>
      </div>

      {/* Resolve Modal */}
      {showResolve && (
        <ResolveModal
          onClose={() => setShowResolve(false)}
          onResolve={handleResolve}
          saving={resolving}
        />
      )}

      {/* Add Users Modal */}
      {showAddUsers && (
        <AddUsersModal
          existingUserIds={new Set(caseDetail.taggedUsers.map(tu => tu.userId))}
          onClose={() => setShowAddUsers(false)}
          onAdd={handleAddUsers}
          saving={addingUsers}
        />
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CaseManager() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [cases, setCases] = useState<CaseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | CaseStatus>('UNRESOLVED')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [detail, setDetail] = useState<CaseDetail | null>(null)

  const loadCases = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search.trim()) params.set('search', search.trim())
      const res = await fetch(`/api/cases?${params}`)
      const data = await res.json()
      setCases(data.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search])

  useEffect(() => { loadCases() }, [loadCases])

  // Deep-link: open case from ?id= query param
  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      fetch(`/api/cases/${id}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setDetail(d) })
        .catch(() => {})
    }
  }, [searchParams])

  async function openDetail(c: CaseSummary) {
    const res = await fetch(`/api/cases/${c.id}`)
    const full: CaseDetail = await res.json()
    setDetail(full)
  }

  function handleCreated(newCase: CaseSummary) {
    setCases(prev => [newCase, ...prev])
    setShowCreate(false)
  }

  function handleUpdated(updated: CaseDetail) {
    setDetail(updated)
    setCases(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
  }

  function handleClose() {
    setDetail(null)
    // Clean up ?id= from URL
    if (searchParams.get('id')) {
      router.replace('/cases', { scroll: false })
    }
  }

  return (
    <div className="p-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FolderOpen size={22} className="text-amazon-blue" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Resolution Center</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-amazon-blue text-white text-sm font-medium rounded-lg hover:bg-amazon-blue/90 transition-colors"
        >
          <Plus size={16} />
          New Case
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex gap-1">
          {(['all', 'UNRESOLVED', 'RESOLVED'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                statusFilter === s
                  ? s === 'all' ? 'bg-amazon-blue text-white'
                    : s === 'UNRESOLVED' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600',
              )}
            >
              {s === 'all' ? 'All' : s === 'UNRESOLVED' ? 'Unresolved' : 'Resolved'}
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search cases…"
            className="pl-9 pr-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue w-56"
          />
        </div>
      </div>

      {/* Case Cards */}
      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : cases.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-400">
          {search || statusFilter !== 'all'
            ? 'No cases match your filters.'
            : 'No cases yet — click New Case to get started.'}
        </div>
      ) : (
        <div className="space-y-2">
          {cases.map(c => (
            <div
              key={c.id}
              onClick={() => openDetail(c)}
              className={clsx(
                'flex items-center gap-4 px-4 py-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 cursor-pointer hover:shadow-md transition-shadow',
                c.status === 'UNRESOLVED' ? 'border-l-amber-500' : 'border-l-green-500',
              )}
            >
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-gray-400 dark:text-gray-500">#{c.caseNumber}</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.title}</span>
                  <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium', STATUS_BADGE[c.status])}>
                    {c.status === 'UNRESOLVED' ? 'Unresolved' : 'Resolved'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                  <span>by {c.createdBy.name}</span>
                  <span>{formatDate(c.createdAt)}</span>
                  {c.taggedUsers.length > 0 && (
                    <span>{c.taggedUsers.length} tagged</span>
                  )}
                </div>
              </div>

              {/* Message count */}
              {c._count.messages > 0 && (
                <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 shrink-0">
                  <MessageSquare size={12} />
                  {c._count.messages}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreated}
        />
      )}

      {/* Detail Slide-over */}
      {detail && user && (
        <DetailPanel
          caseDetail={detail}
          onClose={handleClose}
          onUpdated={handleUpdated}
          onDeleted={() => { setDetail(null); loadCases() }}
          currentUserId={user.dbId}
          currentUserRole={user.role}
        />
      )}
    </div>
  )
}
