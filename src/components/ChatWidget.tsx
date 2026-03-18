'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import {
  MessageSquare,
  X,
  ArrowLeft,
  Send,
  Paperclip,
  FileText,
  Download,
  Search,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatUser {
  id: string
  name: string
  email: string
  lastSeenAt?: string | null
}

interface LastMessage {
  body: string | null
  createdAt: string
  senderId: string
  fileName: string | null
}

interface Conversation {
  id: string
  otherUser: ChatUser
  lastMessage: LastMessage | null
  unreadCount: number
}

interface Message {
  id: string
  senderId: string
  sender: { id: string; name: string }
  body: string | null
  fileName: string | null
  fileUrl: string | null
  fileSize: number | null
  fileMimeType: string | null
  createdAt: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function getDateKey(dateStr: string) {
  return new Date(dateStr).toDateString()
}

function isOnline(lastSeenAt?: string | null) {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < 3 * 60 * 1000
}

function lastSeenLabel(lastSeenAt?: string | null) {
  if (!lastSeenAt) return 'Offline'
  if (isOnline(lastSeenAt)) return 'Online'
  const diff = Date.now() - new Date(lastSeenAt).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `Last seen ${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `Last seen ${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `Last seen ${days}d ago`
}

function OnlineDot({ user }: { user: ChatUser }) {
  if (!isOnline(user.lastSeenAt)) return null
  return (
    <span className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-white dark:ring-gray-900" />
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

type View = 'list' | 'thread' | 'new'

export default function ChatWidget() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('list')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [compose, setCompose] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [allUsers, setAllUsers] = useState<ChatUser[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Message[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastMessageTime = useRef<string | null>(null)

  // ─── Fetch helpers ───────────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    const res = await fetch('/api/chat/conversations')
    if (res.ok) setConversations(await res.json())
  }, [])

  const fetchUnreadCount = useCallback(async () => {
    const res = await fetch('/api/chat/unread-count')
    if (res.ok) {
      const { count } = await res.json()
      setUnreadTotal(count)
    }
  }, [])

  const fetchMessages = useCallback(async (convId: string, after?: string) => {
    const url = `/api/chat/conversations/${convId}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`
    const res = await fetch(url)
    if (!res.ok) return
    const msgs: Message[] = await res.json()
    if (after) {
      // Append only new messages
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id))
        const newMsgs = msgs.filter((m) => !existingIds.has(m.id))
        return newMsgs.length ? [...prev, ...newMsgs] : prev
      })
    } else {
      setMessages(msgs)
    }
    if (msgs.length > 0) {
      lastMessageTime.current = msgs[msgs.length - 1].createdAt
    }
  }, [])

  const markRead = useCallback(async (convId: string) => {
    await fetch(`/api/chat/conversations/${convId}/read`, { method: 'POST' })
  }, [])

  // ─── Polling ─────────────────────────────────────────────────────────────

  // Unread count (when panel closed)
  useEffect(() => {
    if (!user || open) return
    fetchUnreadCount()
    const iv = setInterval(fetchUnreadCount, 10000)
    return () => clearInterval(iv)
  }, [user, open, fetchUnreadCount])

  // Conversation list (when panel open + list view)
  useEffect(() => {
    if (!user || !open || view !== 'list') return
    fetchConversations()
    const iv = setInterval(fetchConversations, 5000)
    return () => clearInterval(iv)
  }, [user, open, view, fetchConversations])

  // Message thread (when panel open + thread view)
  useEffect(() => {
    if (!user || !open || view !== 'thread' || !activeConvId) return
    // Initial full load
    lastMessageTime.current = null
    fetchMessages(activeConvId)
    markRead(activeConvId)
    const iv = setInterval(() => {
      if (lastMessageTime.current) {
        fetchMessages(activeConvId, lastMessageTime.current)
      }
      markRead(activeConvId)
    }, 3000)
    return () => clearInterval(iv)
  }, [user, open, view, activeConvId, fetchMessages, markRead])

  // Auto-scroll on new messages
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages])

  // Heartbeat — update lastSeenAt every 60s while panel is open
  useEffect(() => {
    if (!user || !open) return
    const fire = () => fetch('/api/chat/heartbeat', { method: 'POST' })
    fire()
    const iv = setInterval(fire, 60000)
    return () => clearInterval(iv)
  }, [user, open])

  // ─── Handlers ────────────────────────────────────────────────────────────

  const openConversation = (convId: string) => {
    setActiveConvId(convId)
    setMessages([])
    lastMessageTime.current = null
    setView('thread')
  }

  const sendMessage = async () => {
    if ((!compose.trim() && !file) || !activeConvId || sending) return
    setSending(true)
    try {
      const fd = new FormData()
      if (compose.trim()) fd.append('body', compose.trim())
      if (file) fd.append('file', file)
      const res = await fetch(
        `/api/chat/conversations/${activeConvId}/messages`,
        { method: 'POST', body: fd }
      )
      if (res.ok) {
        const msg: Message = await res.json()
        setMessages((prev) => [...prev, msg])
        lastMessageTime.current = msg.createdAt
        setCompose('')
        setFile(null)
      }
    } finally {
      setSending(false)
    }
  }

  const startNewConversation = async (targetUserId: string) => {
    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: targetUserId }),
    })
    if (res.ok) {
      const conv: Conversation = await res.json()
      openConversation(conv.id)
    }
  }

  const openNewView = async () => {
    setView('new')
    setUserSearch('')
    const res = await fetch('/api/chat/users')
    if (res.ok) setAllUsers(await res.json())
  }

  const searchMessages = useCallback(async (convId: string, q: string) => {
    if (!q.trim()) { setSearchResults([]); return }
    setSearchLoading(true)
    try {
      const res = await fetch(
        `/api/chat/conversations/${convId}/search?q=${encodeURIComponent(q)}`
      )
      if (res.ok) setSearchResults(await res.json())
    } finally {
      setSearchLoading(false)
    }
  }, [])

  const activeConv = conversations.find((c) => c.id === activeConvId)

  if (!user) return null

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Bubble */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition-colors"
      >
        <MessageSquare className="h-6 w-6" />
        {unreadTotal > 0 && !open && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold">
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex w-[380px] flex-col rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
          style={{ height: 520 }}
        >
          {/* ──── List View ──── */}
          {view === 'list' && (
            <>
              <div className="flex items-center justify-between border-b px-4 py-3 dark:border-gray-700">
                <h3 className="text-lg font-semibold">Messages</h3>
                <div className="flex gap-2">
                  <button
                    onClick={openNewView}
                    className="rounded-lg bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                  >
                    New
                  </button>
                  <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {conversations.length === 0 && (
                  <p className="p-6 text-center text-sm text-gray-400">
                    No conversations yet
                  </p>
                )}
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                    className="flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    <div className="relative shrink-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        {c.otherUser.name.charAt(0).toUpperCase()}
                      </div>
                      <OnlineDot user={c.otherUser} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">
                          {c.otherUser.name}
                        </span>
                        {c.lastMessage && (
                          <span className="ml-2 text-xs text-gray-400 shrink-0">
                            {timeAgo(c.lastMessage.createdAt)}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-gray-500">
                        {c.lastMessage
                          ? c.lastMessage.fileName
                            ? `📎 ${c.lastMessage.fileName}`
                            : c.lastMessage.body
                          : 'No messages yet'}
                      </p>
                    </div>
                    {c.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-xs font-bold text-white">
                        {c.unreadCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ──── Thread View ──── */}
          {view === 'thread' && (
            <>
              <div className="flex items-center gap-2 border-b px-3 py-3 dark:border-gray-700">
                <button
                  onClick={() => {
                    setView('list')
                    setActiveConvId(null)
                    fetchConversations()
                    fetchUnreadCount()
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="relative">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                    {activeConv?.otherUser.name.charAt(0).toUpperCase() ?? '?'}
                  </div>
                  {activeConv?.otherUser && <OnlineDot user={activeConv.otherUser} />}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold truncate block">
                    {activeConv?.otherUser.name ?? 'Chat'}
                  </span>
                  {activeConv?.otherUser && (
                    <span className={`text-[10px] ${isOnline(activeConv.otherUser.lastSeenAt) ? 'text-green-500' : 'text-gray-400'}`}>
                      {lastSeenLabel(activeConv.otherUser.lastSeenAt)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => {
                    setSearchOpen(true)
                    setSearchQuery('')
                    setSearchResults([])
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <Search className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Messages */}
              <div ref={threadRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
                {messages.length === 0 && (
                  <p className="pt-8 text-center text-sm text-gray-400">
                    No messages yet. Say hi!
                  </p>
                )}
                {messages.map((msg, i) => {
                  const isMine = msg.senderId === user.dbId
                  const showDate =
                    i === 0 ||
                    getDateKey(msg.createdAt) !==
                      getDateKey(messages[i - 1].createdAt)
                  return (
                    <div key={msg.id}>
                      {showDate && (
                        <div className="my-2 text-center text-xs text-gray-400">
                          {formatDate(msg.createdAt)}
                        </div>
                      )}
                      <div
                        className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                            isMine
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                          }`}
                        >
                          {msg.body && (
                            <p className="whitespace-pre-wrap break-words">
                              {msg.body}
                            </p>
                          )}
                          {msg.fileUrl && (
                            <a
                              href={msg.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`mt-1 flex items-center gap-2 rounded-lg border p-2 text-xs ${
                                isMine
                                  ? 'border-blue-400 hover:bg-blue-700'
                                  : 'border-gray-200 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700'
                              }`}
                            >
                              <FileText className="h-4 w-4 shrink-0" />
                              <span className="min-w-0 truncate">
                                {msg.fileName}
                              </span>
                              {msg.fileSize && (
                                <span className="shrink-0 opacity-70">
                                  {formatFileSize(msg.fileSize)}
                                </span>
                              )}
                              <Download className="h-3 w-3 shrink-0" />
                            </a>
                          )}
                          <div
                            className={`mt-1 text-[10px] ${
                              isMine ? 'text-blue-200' : 'text-gray-400'
                            }`}
                          >
                            {formatTime(msg.createdAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* File preview */}
              {file && (
                <div className="flex items-center gap-2 border-t bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800">
                  <FileText className="h-4 w-4 text-gray-500" />
                  <span className="min-w-0 truncate">{file.name}</span>
                  <span className="text-gray-400">
                    {formatFileSize(file.size)}
                  </span>
                  <button
                    onClick={() => setFile(null)}
                    className="ml-auto text-gray-400 hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Compose */}
              <div className="flex items-end gap-2 border-t px-3 py-2 dark:border-gray-700">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mb-1 text-gray-400 hover:text-gray-600"
                >
                  <Paperclip className="h-5 w-5" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) setFile(e.target.files[0])
                    e.target.value = ''
                  }}
                />
                <textarea
                  value={compose}
                  onChange={(e) => setCompose(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  placeholder="Type a message..."
                  rows={1}
                  className="max-h-20 min-h-[36px] flex-1 resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600"
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || (!compose.trim() && !file)}
                  className="mb-1 text-blue-600 disabled:text-gray-300 hover:text-blue-700"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
            </>
          )}

          {/* ──── New Conversation View ──── */}
          {view === 'new' && (
            <>
              <div className="flex items-center gap-2 border-b px-3 py-3 dark:border-gray-700">
                <button
                  onClick={() => setView('list')}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <span className="text-sm font-semibold">New Message</span>
                <button
                  onClick={() => setOpen(false)}
                  className="ml-auto text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="border-b px-3 py-2 dark:border-gray-700">
                <div className="flex items-center gap-2 rounded-lg border px-2 dark:border-gray-600">
                  <Search className="h-4 w-4 text-gray-400" />
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search users..."
                    className="w-full bg-transparent py-2 text-sm outline-none"
                    autoFocus
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {allUsers
                  .filter(
                    (u) =>
                      u.name
                        .toLowerCase()
                        .includes(userSearch.toLowerCase()) ||
                      u.email
                        .toLowerCase()
                        .includes(userSearch.toLowerCase())
                  )
                  .map((u) => (
                    <button
                      key={u.id}
                      onClick={() => startNewConversation(u.id)}
                      className="flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      <div className="relative">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <OnlineDot user={u} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {u.name}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {u.email}
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ──── Search Modal ──── */}
      {searchOpen && activeConvId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="flex h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl dark:bg-gray-900">
            {/* Header */}
            <div className="flex items-center gap-3 border-b px-4 py-3 dark:border-gray-700">
              <Search className="h-5 w-5 text-gray-400" />
              <input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  if (activeConvId) searchMessages(activeConvId, e.target.value)
                }}
                placeholder="Search messages..."
                className="flex-1 bg-transparent text-sm outline-none"
                autoFocus
              />
              <button
                onClick={() => setSearchOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* Results */}
            <div className="flex-1 overflow-y-auto px-4 py-2">
              {searchLoading && (
                <p className="py-8 text-center text-sm text-gray-400">Searching...</p>
              )}
              {!searchLoading && searchQuery && searchResults.length === 0 && (
                <p className="py-8 text-center text-sm text-gray-400">No results found</p>
              )}
              {!searchLoading && !searchQuery && (
                <p className="py-8 text-center text-sm text-gray-400">Type to search chat history</p>
              )}
              {searchResults.map((msg) => {
                const isMine = msg.senderId === user.dbId
                return (
                  <div key={msg.id} className="border-b py-3 dark:border-gray-700 last:border-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                        {isMine ? 'You' : msg.sender.name}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {formatDate(msg.createdAt)} {formatTime(msg.createdAt)}
                      </span>
                    </div>
                    {msg.body && (
                      <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                        {msg.body}
                      </p>
                    )}
                    {msg.fileName && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                        <FileText className="h-3 w-3" />
                        <span>{msg.fileName}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
