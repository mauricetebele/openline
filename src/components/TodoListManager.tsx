'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ListTodo, Plus, MessageSquare, X, Send, Trash2, Calendar, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/context/AuthContext'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = 'URGENT' | 'NORMAL' | 'LOW'

interface TodoSummary {
  id: string
  title: string
  description: string | null
  priority: Priority
  completed: boolean
  dueDate: string | null
  createdAt: string
  updatedAt: string
  _count: { comments: number }
}

interface TodoComment {
  id: string
  todoId: string
  authorId: string
  author: { id: string; name: string }
  body: string
  createdAt: string
}

interface TodoDetail extends TodoSummary {
  comments: TodoComment[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  URGENT: { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', label: 'Urgent' },
  NORMAL: { border: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', label: 'Normal' },
  LOW:    { border: 'border-l-blue-500', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', label: 'Low' },
} as const

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

function isDueSoon(dueDate: string | null) {
  if (!dueDate) return false
  const diff = new Date(dueDate).getTime() - Date.now()
  return diff > 0 && diff < 86400000 * 2 // within 2 days
}

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false
  return new Date(dueDate).getTime() < Date.now()
}

function AvatarInitial({ name }: { name: string }) {
  const initial = name?.[0]?.toUpperCase() ?? '?'
  return (
    <div className="w-7 h-7 rounded-full bg-amazon-blue flex items-center justify-center text-white text-[10px] font-bold shrink-0">
      {initial}
    </div>
  )
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void
  onCreate: (t: TodoSummary) => void
}

function CreateModal({ onClose, onCreate }: CreateModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('NORMAL')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  async function submit() {
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          dueDate: dueDate || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      const newTodo: TodoSummary = await res.json()
      toast.success('Todo created')
      onCreate(newTodo)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create todo')
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
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">New To Do</h2>
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
              placeholder="What needs to be done?"
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
            <div className="flex gap-2">
              {(['URGENT', 'NORMAL', 'LOW'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={clsx(
                    'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors border',
                    priority === p
                      ? p === 'URGENT' ? 'bg-red-100 border-red-300 text-red-700 dark:bg-red-900/40 dark:border-red-700 dark:text-red-300'
                        : p === 'NORMAL' ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-300'
                        : 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
                  )}
                >
                  {PRIORITY_CONFIG[p].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
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
  todoDetail: TodoDetail
  onClose: () => void
  onUpdated: (updated: TodoDetail) => void
  onDeleted: (id: string) => void
}

function DetailPanel({ todoDetail, onClose, onUpdated, onDeleted }: DetailPanelProps) {
  const [title, setTitle] = useState(todoDetail.title)
  const [description, setDescription] = useState(todoDetail.description ?? '')
  const [priority, setPriority] = useState<Priority>(todoDetail.priority)
  const [dueDate, setDueDate] = useState(todoDetail.dueDate ? todoDetail.dueDate.slice(0, 10) : '')
  const [comments, setComments] = useState<TodoComment[]>(todoDetail.comments)
  const [compose, setCompose] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [comments])

  async function put(data: Record<string, unknown>) {
    const res = await fetch(`/api/todos/${todoDetail.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) return
    const updated: TodoDetail = await res.json()
    onUpdated(updated)
    return updated
  }

  async function handleTitleBlur() {
    if (title.trim() === todoDetail.title) return
    if (!title.trim()) { setTitle(todoDetail.title); return }
    await put({ title: title.trim() })
  }

  async function handleDescriptionBlur() {
    const val = description.trim() || null
    if (val === todoDetail.description) return
    await put({ description: val })
  }

  async function handlePriorityChange(p: Priority) {
    setPriority(p)
    await put({ priority: p })
  }

  async function handleDueDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setDueDate(val)
    await put({ dueDate: val || null })
  }

  async function handleToggleCompleted() {
    await put({ completed: !todoDetail.completed })
  }

  async function handleDelete() {
    if (!confirm('Delete this todo? This cannot be undone.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/todos/${todoDetail.id}`, { method: 'DELETE' })
      if (!res.ok) return
      toast.success('Todo deleted')
      onDeleted(todoDetail.id)
    } finally {
      setDeleting(false)
    }
  }

  async function handleSendComment() {
    if (!compose.trim()) return
    setSendingMsg(true)
    try {
      const res = await fetch(`/api/todos/${todoDetail.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: compose.trim() }),
      })
      if (!res.ok) return
      const newComment: TodoComment = await res.json()
      setComments(prev => [...prev, newComment])
      setCompose('')
      onUpdated({ ...todoDetail, comments: [...comments, newComment], _count: { comments: comments.length + 1 } })
    } finally {
      setSendingMsg(false)
    }
  }

  function handleComposeKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSendComment()
    }
  }

  const cfg = PRIORITY_CONFIG[todoDetail.priority]

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />

      <div className="w-full max-w-[600px] bg-white dark:bg-gray-900 shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
            <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', cfg.badge)}>
              {cfg.label}
            </span>
            {todoDetail.completed && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                Completed
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleCompleted}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                todoDetail.completed
                  ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300'
                  : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300',
              )}
            >
              {todoDetail.completed ? 'Reopen' : 'Mark Done'}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              title="Delete todo"
            >
              <Trash2 size={16} />
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

          {/* Priority */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Priority</label>
            <div className="flex gap-2">
              {(['URGENT', 'NORMAL', 'LOW'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePriorityChange(p)}
                  className={clsx(
                    'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors border',
                    priority === p
                      ? p === 'URGENT' ? 'bg-red-100 border-red-300 text-red-700 dark:bg-red-900/40 dark:border-red-700 dark:text-red-300'
                        : p === 'NORMAL' ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-300'
                        : 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
                  )}
                >
                  {PRIORITY_CONFIG[p].label}
                </button>
              ))}
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={handleDueDateChange}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
          </div>

          {/* Comment Thread */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Comments ({comments.length})
            </label>

            <div
              ref={threadRef}
              className="space-y-3 max-h-[280px] overflow-y-auto pr-1 mb-3"
            >
              {comments.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 italic">No comments yet.</p>
              )}
              {comments.map(c => (
                <div key={c.id} className="flex gap-3">
                  <AvatarInitial name={c.author.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{c.author.name}</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{relativeTime(c.createdAt)}</span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
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
                placeholder="Write a comment… (Cmd+Enter to send)"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none resize-none"
              />
              <div className="flex justify-end px-3 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleSendComment}
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
            Created {formatDateTime(todoDetail.createdAt)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TodoListManager() {
  const { user } = useAuth()
  const [todos, setTodos] = useState<TodoSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [priorityFilter, setPriorityFilter] = useState<'ALL' | Priority>('ALL')
  const [showCompleted, setShowCompleted] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [detail, setDetail] = useState<TodoDetail | null>(null)

  const loadTodos = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/todos')
      const data = await res.json()
      setTodos(data.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTodos() }, [loadTodos])

  const filtered = todos.filter(t => {
    if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false
    if (!showCompleted && t.completed) return false
    return true
  })

  async function openDetail(t: TodoSummary) {
    const res = await fetch(`/api/todos/${t.id}`)
    const full: TodoDetail = await res.json()
    setDetail(full)
  }

  function handleCreated(newTodo: TodoSummary) {
    setTodos(prev => [newTodo, ...prev])
    setShowCreate(false)
  }

  function handleUpdated(updated: TodoDetail) {
    setDetail(updated)
    setTodos(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t))
  }

  function handleDeleted(id: string) {
    setDetail(null)
    setTodos(prev => prev.filter(t => t.id !== id))
  }

  async function toggleCompleted(e: React.MouseEvent, todo: TodoSummary) {
    e.stopPropagation()
    const res = await fetch(`/api/todos/${todo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: !todo.completed }),
    })
    if (!res.ok) return
    const updated = await res.json()
    setTodos(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t))
  }

  return (
    <div className="p-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ListTodo size={22} className="text-amazon-blue" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">To Do List</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-amazon-blue text-white text-sm font-medium rounded-lg hover:bg-amazon-blue/90 transition-colors"
        >
          <Plus size={16} />
          New To Do
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex gap-1">
          {(['ALL', 'URGENT', 'NORMAL', 'LOW'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                priorityFilter === p
                  ? p === 'ALL' ? 'bg-amazon-blue text-white'
                    : p === 'URGENT' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    : p === 'NORMAL' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600',
              )}
            >
              {p === 'ALL' ? 'All' : PRIORITY_CONFIG[p].label}
            </button>
          ))}
        </div>

        <label className="ml-auto flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={e => setShowCompleted(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600 text-amazon-blue focus:ring-amazon-blue"
          />
          Show completed
        </label>
      </div>

      {/* Cards */}
      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-400">
          {todos.length === 0
            ? 'No todos yet — click New To Do to get started.'
            : 'No todos match your filters.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(todo => {
            const cfg = PRIORITY_CONFIG[todo.priority]
            return (
              <div
                key={todo.id}
                onClick={() => openDetail(todo)}
                className={clsx(
                  'flex items-center gap-4 px-4 py-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 cursor-pointer hover:shadow-md transition-shadow',
                  cfg.border,
                  todo.completed && 'opacity-60',
                )}
              >
                {/* Checkbox */}
                <button
                  onClick={(e) => toggleCompleted(e, todo)}
                  className={clsx(
                    'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                    todo.completed
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'border-gray-300 dark:border-gray-500 hover:border-amazon-blue',
                  )}
                >
                  {todo.completed && <Check size={12} strokeWidth={3} />}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={clsx(
                      'text-sm font-medium text-gray-900 dark:text-white',
                      todo.completed && 'line-through text-gray-400 dark:text-gray-500',
                    )}>
                      {todo.title}
                    </span>
                    <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium', cfg.badge)}>
                      {cfg.label}
                    </span>
                  </div>
                  {todo.dueDate && (
                    <div className={clsx(
                      'flex items-center gap-1 text-xs mt-1',
                      isOverdue(todo.dueDate) && !todo.completed ? 'text-red-500' :
                      isDueSoon(todo.dueDate) && !todo.completed ? 'text-amber-500' :
                      'text-gray-400 dark:text-gray-500',
                    )}>
                      <Calendar size={11} />
                      {formatDate(todo.dueDate)}
                      {isOverdue(todo.dueDate) && !todo.completed && ' (overdue)'}
                    </div>
                  )}
                </div>

                {/* Comment count */}
                {todo._count.comments > 0 && (
                  <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 shrink-0">
                    <MessageSquare size={12} />
                    {todo._count.comments}
                  </span>
                )}
              </div>
            )
          })}
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
      {detail && (
        <DetailPanel
          todoDetail={detail}
          onClose={() => setDetail(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
