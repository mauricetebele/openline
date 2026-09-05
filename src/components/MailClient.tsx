'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import {
  Mail, Inbox, Star, Send, FileText, AlertOctagon, Trash2, Tag, Loader2, X,
  RefreshCw, Reply, Archive, MailOpen, Plus, Search, Paperclip, Copy, Users, FolderPlus, FolderInput, Sparkles, Check, Download,
} from 'lucide-react'

interface Account { id: string; email: string; displayName?: string | null; assignedUserId?: string | null; assignedUser?: { id: string; name: string; email: string } | null }
interface SiteUser { id: string; name: string; email: string; canAccessMail?: boolean; role?: string }
interface GLabel { id: string; name: string; type: string; messagesUnread?: number }
interface MsgSummary { id: string; threadId: string; from: string; subject: string; snippet: string; date: number | null; unread: boolean; labelIds: string[] }
interface MsgDetail {
  id: string; threadId: string; from: string; to: string; cc: string; subject: string
  messageId: string; references: string; date: number | null; labelIds: string[]
  html: string; text: string; attachments: { filename: string; mimeType: string; attachmentId: string; size: number }[]
}

const SYSTEM_FOLDERS = [
  { id: 'INBOX', name: 'Inbox', icon: Inbox },
  { id: 'STARRED', name: 'Starred', icon: Star },
  { id: 'SENT', name: 'Sent', icon: Send },
  { id: 'DRAFT', name: 'Drafts', icon: FileText },
  { id: 'SPAM', name: 'Spam', icon: AlertOctagon },
  { id: 'TRASH', name: 'Trash', icon: Trash2 },
]

function parseFrom(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/)
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() }
  return { name: raw.trim(), email: raw.trim() }
}
function fmtDate(ms: number | null): string {
  if (!ms) return ''
  const d = new Date(ms); const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Wrap an email body with a Gmail-like default font so unstyled mail doesn't
// fall back to the browser's Times New Roman. The email's own inline styles win.
function wrapEmailHtml(html: string, text: string): string {
  const bodyContent = html || `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(text)}</pre>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:14px;}
  body{font-family:Arial,Roboto,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#202124;word-wrap:break-word;overflow-wrap:anywhere;}
  a{color:#1a73e8;}
  img{max-width:100%;height:auto;}
  table{max-width:100%;}
  blockquote{margin:0 0 0 8px;padding-left:12px;border-left:2px solid #e0e0e0;color:#5f6368;}
</style></head><body>${bodyContent}</body></html>`
}

function avatarColor(seed: string): string {
  const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500']
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}

// Gmail-style recipient field: committed addresses become pills; a comma, Enter,
// or picking a suggestion commits the current address and moves on. Suggestions
// render in a custom dropdown (avatar + name + email, keyboard-navigable).
function RecipientInput({ emails, onChange, contacts, placeholder, onPending }: {
  emails: string[]; onChange: (e: string[]) => void; contacts: { name: string; email: string }[]; placeholder: string; onPending?: (t: string) => void
}) {
  const [text, setTextState] = useState('')
  const [focused, setFocused] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const setText = (v: string) => { setTextState(v); setHighlight(0); onPending?.(v) }

  const q = text.trim().toLowerCase()
  const chosen = new Set(emails.map(e => e.toLowerCase()))
  const matches = q
    ? contacts.filter(c => !chosen.has(c.email) && (c.email.includes(q) || c.name.toLowerCase().includes(q))).slice(0, 8)
    : []
  const showDrop = focused && matches.length > 0

  function commit(values: string[]) {
    const set = new Set(emails.map(e => e.toLowerCase()))
    const merged = [...emails]
    for (const v of values) {
      const e = v.trim().replace(/^</, '').replace(/>$/, '').trim()
      if (e.includes('@') && !set.has(e.toLowerCase())) { merged.push(e); set.add(e.toLowerCase()) }
    }
    if (merged.length !== emails.length) onChange(merged)
  }
  function pick(email: string) { commit([email]); setText('') }

  function onChangeText(v: string) {
    if (/[,;]/.test(v)) { const parts = v.split(/[,;]+/); const tail = parts.pop() ?? ''; commit(parts); setText(tail); return }
    setText(v)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.metaKey || e.ctrlKey) return // let ⌘/Ctrl+Enter bubble up to Send
    if (showDrop && e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, matches.length - 1)) }
    else if (showDrop && e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      if (showDrop && matches[highlight]) { e.preventDefault(); pick(matches[highlight].email) }
      else if (text.trim()) { if (e.key === 'Enter') e.preventDefault(); commit([text]); setText('') }
    } else if (e.key === 'Escape') { setFocused(false) }
    else if (e.key === 'Backspace' && !text && emails.length) { onChange(emails.slice(0, -1)) }
  }

  return (
    <div className="relative">
      <div className="w-full min-h-9 flex flex-wrap items-center gap-1 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-1.5 py-1 focus-within:ring-2 focus-within:ring-amazon-blue focus-within:border-amazon-blue">
        {emails.map((e, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded-full pl-2 pr-1 py-0.5">
            {e}
            <button onClick={() => onChange(emails.filter((_, j) => j !== i))} className="text-blue-400 hover:text-red-500"><X size={11} /></button>
          </span>
        ))}
        <input
          value={text}
          onChange={ev => onChangeText(ev.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (text.trim()) { commit([text]); setText('') } }}
          placeholder={emails.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] h-6 bg-transparent text-sm text-gray-900 dark:text-white outline-none px-1"
        />
      </div>
      {showDrop && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-[60] max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5 py-1">
          {matches.map((c, i) => {
            const initial = (c.name || c.email).trim().charAt(0).toUpperCase()
            return (
              <li key={c.email}>
                <button
                  onMouseDown={e => { e.preventDefault(); pick(c.email) }}
                  onMouseEnter={() => setHighlight(i)}
                  className={clsx('w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors', i === highlight ? 'bg-amazon-blue/10' : 'hover:bg-gray-50 dark:hover:bg-white/5')}
                >
                  <span className={clsx('shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold', avatarColor(c.email))}>{initial}</span>
                  <span className="min-w-0 flex-1">
                    {c.name && <span className="block text-sm text-gray-900 dark:text-white truncate leading-tight">{c.name}</span>}
                    <span className={clsx('block truncate leading-tight', c.name ? 'text-xs text-gray-500 dark:text-gray-400' : 'text-sm text-gray-900 dark:text-white')}>{c.email}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function MailClient() {
  const params = useSearchParams()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [configured, setConfigured] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [showMailboxes, setShowMailboxes] = useState(false)
  const [siteUsers, setSiteUsers] = useState<SiteUser[]>([])
  const [contacts, setContacts] = useState<{ name: string; email: string }[]>([])
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const [selectedMsgs, setSelectedMsgs] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showBulkMove, setShowBulkMove] = useState(false)
  const [activeAccount, setActiveAccount] = useState<string>('')
  const [labels, setLabels] = useState<GLabel[]>([])
  const [folder, setFolder] = useState('INBOX')
  const [search, setSearch] = useState('')
  const [messages, setMessages] = useState<MsgSummary[]>([])
  const [nextToken, setNextToken] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<MsgDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showMove, setShowMove] = useState(false)
  const [attLoading, setAttLoading] = useState<string | null>(null)
  const [attPreview, setAttPreview] = useState<{ url: string; filename: string; kind: 'image' | 'pdf' } | null>(null)

  function triggerDownload(url: string, filename: string) {
    const a = document.createElement('a'); a.href = url; a.download = filename || 'attachment'
    document.body.appendChild(a); a.click(); a.remove()
  }

  async function openAttachment(messageId: string, att: { attachmentId: string; filename: string; mimeType: string }) {
    setAttLoading(att.attachmentId)
    try {
      const res = await fetch(`/api/email/messages/${messageId}/attachments/${att.attachmentId}?accountId=${activeAccount}`)
      const d = await res.json()
      if (!res.ok || !d.data) throw new Error(d.error ?? 'Failed to load attachment')
      const bytes = Uint8Array.from(atob(d.data), c => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: att.mimeType || 'application/octet-stream' }))
      const isImg = (att.mimeType || '').startsWith('image/')
      const isPdf = att.mimeType === 'application/pdf'
      if (isImg || isPdf) {
        setAttPreview({ url, filename: att.filename, kind: isImg ? 'image' : 'pdf' })
      } else {
        triggerDownload(url, att.filename)
        setTimeout(() => URL.revokeObjectURL(url), 30_000)
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not open attachment') }
    finally { setAttLoading(null) }
  }
  function closePreview() { if (attPreview) URL.revokeObjectURL(attPreview.url); setAttPreview(null) }
  const [compose, setCompose] = useState<null | { to: string[]; cc: string[]; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string; attachments?: { filename: string; mimeType: string; contentBase64: string; size: number }[] }>(null)
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composeToPending = useRef('')
  const contactsLoadedFor = useRef<string | null>(null)

  // AI rule creation
  const [showRules, setShowRules] = useState(false)
  const [ruleText, setRuleText] = useState('')
  const [ruleBusy, setRuleBusy] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ruleResult, setRuleResult] = useState<{ understanding?: string; rule?: any; needsClarification?: string | null } | null>(null)
  const [aiConfigured, setAiConfigured] = useState(true)
  const [aiKey, setAiKey] = useState('')
  const [aiSaving, setAiSaving] = useState(false)

  useEffect(() => {
    if (showRules && isAdmin) fetch('/api/admin/ai-config').then(r => r.json()).then(d => setAiConfigured(!!d.configured)).catch(() => {})
  }, [showRules, isAdmin])

  async function saveAiKey() {
    if (!aiKey.trim()) { toast.error('Paste your Anthropic API key'); return }
    setAiSaving(true)
    try {
      const res = await fetch('/api/admin/ai-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anthropicKey: aiKey.trim() }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success('AI key saved'); setAiConfigured(true); setAiKey('')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to save key') }
    finally { setAiSaving(false) }
  }

  async function interpretRule() {
    if (!ruleText.trim()) return
    setRuleBusy(true); setRuleResult(null)
    try {
      const res = await fetch('/api/email/rules/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ruleText.trim() }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setRuleResult(d)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not interpret the rule') }
    finally { setRuleBusy(false) }
  }
  async function applyRule() {
    if (!ruleResult?.rule) return
    setRuleBusy(true)
    try {
      const res = await fetch('/api/email/rules/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: activeAccount, rule: ruleResult.rule }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success(`Rule created${d.applied ? ` · ${d.applied} existing email${d.applied !== 1 ? 's' : ''} moved` : ''}`)
      setShowRules(false); setRuleText(''); setRuleResult(null)
      loadLabels(activeAccount)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create the rule') }
    finally { setRuleBusy(false) }
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const readers = Array.from(files).map(f => new Promise<{ filename: string; mimeType: string; contentBase64: string; size: number }>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve({ filename: f.name, mimeType: f.type || 'application/octet-stream', contentBase64: String(r.result).split(',').pop() || '', size: f.size })
      r.onerror = reject
      r.readAsDataURL(f)
    }))
    try {
      const results = await Promise.all(readers)
      setCompose(c => {
        if (!c) return c
        const next = [...(c.attachments ?? []), ...results]
        const total = next.reduce((s, a) => s + a.size, 0)
        if (total > 24 * 1024 * 1024) { toast.error('Attachments exceed 24 MB'); return c }
        return { ...c, attachments: next }
      })
    } catch { toast.error('Could not read file') }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  const [cfgClientId, setCfgClientId] = useState('')
  const [cfgClientSecret, setCfgClientSecret] = useState('')
  const [savingCfg, setSavingCfg] = useState(false)
  const bootstrapped = useRef(false)

  const redirectUri = typeof window !== 'undefined' ? `${window.location.origin}/api/email/google/callback` : ''

  async function saveConfig() {
    if (!cfgClientId.trim() || !cfgClientSecret.trim()) { toast.error('Enter both the Client ID and Client Secret'); return }
    setSavingCfg(true)
    try {
      const res = await fetch('/api/email/oauth-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: cfgClientId.trim(), clientSecret: cfgClientSecret.trim() }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed to save')
      toast.success('Saved — you can connect a mailbox now')
      setCfgClientSecret(''); setConfigured(true)
      await loadAccounts()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to save') }
    finally { setSavingCfg(false) }
  }

  // ── Loaders ──
  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/email/accounts')
    const d = await res.json()
    setConfigured(d.configured ?? true)
    setAccounts(d.accounts ?? [])
    setIsAdmin(!!d.isAdmin)
    return d.accounts as Account[]
  }, [])

  async function openMailboxes() {
    setShowMailboxes(true)
    try { const d = await (await fetch('/api/admin/users')).json(); setSiteUsers(d.data ?? []) } catch { /* ignore */ }
  }
  async function assignMailbox(accountId: string, assignedUserId: string | null) {
    try {
      const res = await fetch('/api/email/accounts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId, assignedUserId }) })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Mailbox assignment updated')
      loadAccounts()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  async function disconnectMailbox(accountId: string, email: string) {
    if (!window.confirm(`Disconnect ${email}? Its mail will no longer be accessible from the site.`)) return
    try {
      await fetch(`/api/email/accounts?id=${accountId}`, { method: 'DELETE' })
      toast.success('Disconnected')
      const accts = await loadAccounts()
      if (activeAccount === accountId) { const first = accts[0]; if (first) switchAccount(first.id); else { setShowMailboxes(false) } }
    } catch { toast.error('Failed to disconnect') }
  }

  const loadLabels = useCallback(async (accountId: string) => {
    try { const d = await (await fetch(`/api/email/labels?accountId=${accountId}`)).json(); setLabels(d.labels ?? []) } catch { /* ignore */ }
  }, [])

  const loadContacts = useCallback(async (accountId: string) => {
    setContacts([])
    try { const d = await (await fetch(`/api/email/contacts?accountId=${accountId}`)).json(); setContacts(d.contacts ?? []) } catch { /* ignore */ }
  }, [])

  const loadMessages = useCallback(async (accountId: string, folderId: string, q: string) => {
    setLoadingList(true); setSelected(null); setDetail(null); setNeedsReconnect(false); setSelectedMsgs(new Set()); setShowBulkMove(false)
    try {
      const qp = new URLSearchParams({ accountId, labelIds: folderId })
      if (q.trim()) qp.set('q', q.trim())
      const d = await (await fetch(`/api/email/messages?${qp.toString()}`)).json()
      if (d.error) throw new Error(d.error)
      setMessages(d.messages ?? []); setNextToken(d.nextPageToken ?? null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load mail'
      if (/invalid_grant|invalid_rapt|reauth|token refresh|reconnect/i.test(msg)) { setNeedsReconnect(true); setMessages([]) }
      else toast.error(msg)
    }
    finally { setLoadingList(false) }
  }, [])

  const loadMore = useCallback(async () => {
    if (!nextToken || !activeAccount) return
    const qp = new URLSearchParams({ accountId: activeAccount, labelIds: folder, pageToken: nextToken })
    if (search.trim()) qp.set('q', search.trim())
    const d = await (await fetch(`/api/email/messages?${qp.toString()}`)).json()
    setMessages(prev => [...prev, ...(d.messages ?? [])]); setNextToken(d.nextPageToken ?? null)
  }, [nextToken, activeAccount, folder, search])

  // Bootstrap
  useEffect(() => {
    if (bootstrapped.current) return; bootstrapped.current = true
    ;(async () => {
      const accts = await loadAccounts()
      if (accts.length) { setActiveAccount(accts[0].id); loadLabels(accts[0].id); loadMessages(accts[0].id, 'INBOX', '') }
    })()
  }, [loadAccounts, loadLabels, loadMessages])

  // OAuth redirect feedback
  useEffect(() => {
    const connected = params.get('connected'); const error = params.get('error')
    if (connected) { toast.success(`Connected ${connected}`); window.history.replaceState({}, '', '/mail') }
    else if (error) { toast.error(error === 'not_configured' ? 'Gmail OAuth is not configured yet' : error === 'no_access' ? 'You do not have Mail access' : `Connect failed: ${error}`); window.history.replaceState({}, '', '/mail') }
  }, [params])

  function switchAccount(id: string) { setActiveAccount(id); setFolder('INBOX'); setSearch(''); contactsLoadedFor.current = null; setContacts([]); loadLabels(id); loadMessages(id, 'INBOX', '') }
  // Load contacts on demand (first compose) instead of on page load, to avoid a burst of Gmail calls.
  function ensureContacts() { if (activeAccount && contactsLoadedFor.current !== activeAccount) { contactsLoadedFor.current = activeAccount; loadContacts(activeAccount) } }
  function openFolder(id: string) { setFolder(id); setSearch(''); loadMessages(activeAccount, id, '') }
  function runSearch() { loadMessages(activeAccount, folder, search) }

  async function openMessage(id: string) {
    setSelected(id); setLoadingDetail(true); setDetail(null); setShowMove(false)
    try {
      const d = await (await fetch(`/api/email/messages/${id}?accountId=${activeAccount}`)).json()
      if (d.error) throw new Error(d.error)
      setDetail(d)
      setMessages(prev => prev.map(m => m.id === id ? { ...m, unread: false } : m)) // reflect read
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to open message') }
    finally { setLoadingDetail(false) }
  }

  async function modify(id: string, add: string[] | undefined, remove: string[] | undefined, removeFromList = false) {
    await fetch(`/api/email/messages/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: activeAccount, addLabelIds: add, removeLabelIds: remove }) })
    if (removeFromList) { setMessages(prev => prev.filter(m => m.id !== id)); if (selected === id) { setSelected(null); setDetail(null) } }
  }
  async function archive(id: string) { await modify(id, undefined, ['INBOX'], folder === 'INBOX'); toast.success('Archived') }

  // ── Bulk selection ──
  const toggleMsg = (id: string) => setSelectedMsgs(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allSelected = messages.length > 0 && messages.every(m => selectedMsgs.has(m.id))
  const toggleSelectAll = () => setSelectedMsgs(prev => messages.every(m => prev.has(m.id)) ? new Set() : new Set(messages.map(m => m.id)))

  async function runBulk(body: object, removeFromList: boolean, marksUnread?: boolean) {
    const ids = Array.from(selectedMsgs)
    if (!ids.length) return
    setBulkBusy(true)
    try {
      const res = await fetch('/api/email/messages/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: activeAccount, ids, ...body }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      if (removeFromList) {
        setMessages(prev => prev.filter(m => !selectedMsgs.has(m.id)))
        if (selected && selectedMsgs.has(selected)) { setSelected(null); setDetail(null) }
      } else if (marksUnread !== undefined) {
        setMessages(prev => prev.map(m => selectedMsgs.has(m.id) ? { ...m, unread: marksUnread } : m))
      }
      toast.success(`${d.count} message${d.count !== 1 ? 's' : ''} updated`)
      setSelectedMsgs(new Set()); setShowBulkMove(false)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bulk action failed') }
    finally { setBulkBusy(false) }
  }
  const bulkArchive = () => runBulk({ removeLabelIds: ['INBOX'] }, folder === 'INBOX')
  const bulkTrash = () => runBulk({ trash: true }, true)
  const bulkRead = () => runBulk({ removeLabelIds: ['UNREAD'] }, false, false)
  const bulkUnread = () => runBulk({ addLabelIds: ['UNREAD'] }, false, true)
  function bulkMove(labelId: string) {
    const remove = ['INBOX']
    if (labels.some(l => l.type === 'user' && l.id === folder)) remove.push(folder)
    runBulk({ addLabelIds: [labelId], removeLabelIds: remove }, true)
  }
  async function bulkMoveNewFolder() { const id = await createFolder(); if (id) bulkMove(id) }

  async function createFolder(): Promise<string | undefined> {
    const name = window.prompt('New folder name')
    if (!name || !name.trim()) return undefined
    try {
      const res = await fetch('/api/email/labels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: activeAccount, name: name.trim() }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success(`Folder "${name.trim()}" created`)
      loadLabels(activeAccount)
      return d.label?.id as string | undefined
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to create folder'); return undefined }
  }

  async function moveTo(id: string, labelId: string, labelName: string) {
    const remove = ['INBOX']
    if (labels.some(l => l.type === 'user' && l.id === folder)) remove.push(folder)
    await modify(id, [labelId], remove, true)
    setShowMove(false)
    toast.success(`Moved to ${labelName}`)
  }
  async function moveToNewFolder(id: string) {
    const labelId = await createFolder()
    if (labelId) moveTo(id, labelId, 'new folder')
  }
  async function markUnread(id: string) { await modify(id, ['UNREAD'], undefined); setMessages(prev => prev.map(m => m.id === id ? { ...m, unread: true } : m)); toast.success('Marked unread') }
  async function trash(id: string) {
    await fetch(`/api/email/messages/${id}?accountId=${activeAccount}`, { method: 'DELETE' })
    setMessages(prev => prev.filter(m => m.id !== id)); if (selected === id) { setSelected(null); setDetail(null) }
    toast.success('Moved to Trash')
  }

  function startReply() {
    if (!detail) return
    composeToPending.current = ''; ensureContacts()
    const to = parseFrom(detail.from).email
    setCompose({
      to: to ? [to] : [], cc: [], subject: detail.subject.startsWith('Re:') ? detail.subject : `Re: ${detail.subject}`,
      body: '', threadId: detail.threadId, inReplyTo: detail.messageId,
      references: [detail.references, detail.messageId].filter(Boolean).join(' '),
    })
  }
  function startCompose() { composeToPending.current = ''; ensureContacts(); setCompose({ to: [], cc: [], subject: '', body: '' }) }

  function composeKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendMail() }
  }

  async function sendMail() {
    if (!compose) return
    // Include any address still being typed (not yet turned into a pill).
    const pendingTo = composeToPending.current.trim()
    const toList = pendingTo && pendingTo.includes('@') && !compose.to.includes(pendingTo) ? [...compose.to, pendingTo] : compose.to
    if (toList.length === 0) { toast.error('Enter a recipient'); return }
    setSending(true)
    try {
      const html = escapeHtml(compose.body).replace(/\n/g, '<br>')
      const res = await fetch('/api/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        accountId: activeAccount, to: toList.join(', '), cc: compose.cc.length ? compose.cc.join(', ') : undefined, subject: compose.subject, html,
        threadId: compose.threadId, inReplyTo: compose.inReplyTo, references: compose.references,
        attachments: compose.attachments?.map(a => ({ filename: a.filename, mimeType: a.mimeType, contentBase64: a.contentBase64 })),
      }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Send failed')
      toast.success('Sent'); setCompose(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Send failed') }
    finally { setSending(false) }
  }

  const userLabels = labels.filter(l => l.type === 'user')

  // ── Not-connected states ──
  if (!bootstrapped.current || accounts.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 p-8">
        {!configured ? (
          <div className="w-full max-w-md space-y-3">
            <div className="flex items-center gap-2"><Mail size={20} className="text-amazon-blue" /><h2 className="text-sm font-bold text-gray-900 dark:text-white">Connect Gmail — one-time setup</h2></div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Paste the Client ID and Client Secret from your Google Cloud OAuth client. They&apos;re stored encrypted in your database.</p>
            <div className="rounded-md bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 px-3 py-2 text-[11px]">
              <p className="text-gray-500 dark:text-gray-400 mb-1">In Google Cloud, set the OAuth client&apos;s <span className="font-semibold">Authorized redirect URI</span> to:</p>
              <div className="flex items-center gap-1.5">
                <code className="font-mono text-gray-800 dark:text-gray-200 break-all">{redirectUri}</code>
                <button onClick={() => { navigator.clipboard.writeText(redirectUri); toast.success('Copied') }} className="shrink-0 text-amazon-blue hover:text-blue-700"><Copy size={12} /></button>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Client ID</label>
              <input value={cfgClientId} onChange={e => setCfgClientId(e.target.value)} placeholder="…apps.googleusercontent.com" className="w-full h-9 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2.5 text-sm text-gray-900 dark:text-white font-mono" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Client Secret</label>
              <input type="password" value={cfgClientSecret} onChange={e => setCfgClientSecret(e.target.value)} placeholder="GOCSPX-…" className="w-full h-9 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2.5 text-sm text-gray-900 dark:text-white font-mono" />
            </div>
            <button onClick={saveConfig} disabled={savingCfg} className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-md bg-amazon-blue text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
              {savingCfg ? <Loader2 size={15} className="animate-spin" /> : null} Save credentials
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <Mail size={40} className="text-gray-300" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">No mailbox connected</p>
            <a href="/api/email/google/connect" className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700"><Plus size={15} /> Connect a Gmail account</a>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="px-4 py-2.5 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 flex items-center gap-3">
        <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5"><Mail size={16} className="text-amazon-blue" /> Mail</h1>
        <select value={activeAccount} onChange={e => switchAccount(e.target.value)} className="h-8 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2 text-xs text-gray-800 dark:text-gray-200 max-w-[220px]">
          {accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
        </select>
        <a href="/api/email/google/connect" title="Connect another account" className="text-xs text-amazon-blue hover:underline inline-flex items-center gap-1"><Plus size={12} /> Add</a>
        {isAdmin && <button onClick={openMailboxes} title="Manage mailboxes & assignments" className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 inline-flex items-center gap-1"><Users size={12} /> Mailboxes</button>}
        <div className="flex-1" />
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()} placeholder="Search mail…"
            className="h-8 w-56 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 pl-7 pr-2 text-xs text-gray-800 dark:text-gray-200" />
        </div>
        {/* AI Rules — hidden for now (uses the paid Anthropic API). Re-enable by restoring this button. */}
        {false && <button onClick={() => { setShowRules(true); setRuleResult(null) }} className="hidden"><Sparkles size={14} /> Rules</button>}
        <button onClick={startCompose} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-amazon-blue text-white text-xs font-semibold hover:bg-blue-700"><Plus size={14} /> Compose</button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Folders */}
        <div className="w-44 shrink-0 border-r bg-gray-50 dark:bg-gray-900/50 dark:border-gray-700 overflow-y-auto py-2">
          {SYSTEM_FOLDERS.map(f => {
            const I = f.icon; const active = folder === f.id
            const unread = labels.find(l => l.id === f.id)?.messagesUnread
            return (
              <button key={f.id} onClick={() => openFolder(f.id)} className={clsx('w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium', active ? 'bg-amazon-blue/10 text-amazon-blue' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5')}>
                <I size={14} /> <span className="flex-1 text-left">{f.name}</span>
                {f.id === 'INBOX' && unread ? <span className="text-[10px] font-bold text-amazon-blue">{unread}</span> : null}
              </button>
            )
          })}
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Folders</p>
            <button onClick={createFolder} title="New folder" className="text-gray-400 hover:text-amazon-blue"><FolderPlus size={13} /></button>
          </div>
          {userLabels.map(l => (
            <button key={l.id} onClick={() => openFolder(l.id)} className={clsx('w-full flex items-center gap-2 px-3 py-1.5 text-xs', folder === l.id ? 'bg-amazon-blue/10 text-amazon-blue' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5')}>
              <Tag size={13} /> <span className="flex-1 text-left truncate">{l.name}</span>
            </button>
          ))}
        </div>

        {/* List */}
        <div className="w-[360px] shrink-0 border-r dark:border-gray-700 overflow-y-auto">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-20">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all"
              className="rounded border-gray-300 text-amazon-blue focus:ring-amazon-blue cursor-pointer shrink-0" />
            {selectedMsgs.size > 0 ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <span className="text-[11px] font-semibold text-amazon-blue mr-1">{selectedMsgs.size} selected</span>
                <div className="flex-1" />
                {bulkBusy && <Loader2 size={13} className="animate-spin text-gray-400" />}
                <button onClick={bulkArchive} disabled={bulkBusy} title="Archive" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"><Archive size={14} /></button>
                <button onClick={bulkTrash} disabled={bulkBusy} title="Trash" className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 hover:text-red-500"><Trash2 size={14} /></button>
                <button onClick={bulkRead} disabled={bulkBusy} title="Mark read" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"><MailOpen size={14} /></button>
                <button onClick={bulkUnread} disabled={bulkBusy} title="Mark unread" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"><Mail size={14} /></button>
                <div className="relative">
                  <button onClick={() => setShowBulkMove(v => !v)} disabled={bulkBusy} title="Move to folder" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"><FolderInput size={14} /></button>
                  {showBulkMove && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowBulkMove(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 w-52 max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-800 shadow-xl py-1">
                        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Move to</p>
                        {userLabels.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No folders yet</p>}
                        {userLabels.map(l => (
                          <button key={l.id} onClick={() => bulkMove(l.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5"><Tag size={13} className="text-gray-400" /> <span className="truncate">{l.name}</span></button>
                        ))}
                        <button onClick={bulkMoveNewFolder} className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-amazon-blue hover:bg-gray-50 dark:hover:bg-white/5 border-t border-gray-100 dark:border-white/5 mt-1 pt-2"><FolderPlus size={13} /> New folder…</button>
                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => setSelectedMsgs(new Set())} title="Clear selection" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400"><X size={14} /></button>
              </div>
            ) : (
              <>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{SYSTEM_FOLDERS.find(f => f.id === folder)?.name ?? userLabels.find(l => l.id === folder)?.name ?? folder}</span>
                <div className="flex-1" />
                <button onClick={() => loadMessages(activeAccount, folder, search)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white"><RefreshCw size={13} /></button>
              </>
            )}
          </div>
          {needsReconnect ? (
            <div className="p-4 m-3 rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 text-center space-y-2">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">This mailbox needs to be reconnected</p>
              <p className="text-xs text-amber-700 dark:text-amber-300/90">Google requires re-authentication (Workspace session policy). Reconnect to refresh access.</p>
              <a href="/api/email/google/connect" className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md bg-amazon-blue text-white text-xs font-semibold hover:bg-blue-700"><RefreshCw size={13} /> Reconnect mailbox</a>
            </div>
          ) : loadingList ? (
            <div className="py-16 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</div>
          ) : messages.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">No messages</div>
          ) : (
            <>
              {messages.map(m => {
                const f = parseFrom(m.from)
                const isSel = selectedMsgs.has(m.id)
                return (
                  <div key={m.id} className={clsx('flex items-start gap-2 px-3 py-2 border-b dark:border-gray-800',
                    selected === m.id ? 'bg-amazon-blue/10' : isSel ? 'bg-amber-50 dark:bg-amber-900/10' : 'hover:bg-gray-50 dark:hover:bg-white/5')}>
                    <input type="checkbox" checked={isSel} onChange={() => toggleMsg(m.id)} onClick={e => e.stopPropagation()} aria-label="Select message"
                      className="mt-0.5 rounded border-gray-300 text-amazon-blue focus:ring-amazon-blue cursor-pointer shrink-0" />
                    <button onClick={() => openMessage(m.id)} className="flex-1 min-w-0 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <span className={clsx('text-xs truncate', m.unread ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300')}>{f.name}</span>
                        <span className="text-[10px] text-gray-400 shrink-0">{fmtDate(m.date)}</span>
                      </div>
                      <div className={clsx('text-xs truncate', m.unread ? 'font-semibold text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-400')}>{m.subject || '(no subject)'}</div>
                      <div className="text-[11px] text-gray-400 truncate">{m.snippet}</div>
                    </button>
                  </div>
                )
              })}
              {nextToken && <button onClick={loadMore} className="w-full py-2 text-xs text-amazon-blue hover:underline">Load more</button>}
            </>
          )}
        </div>

        {/* Reading pane */}
        <div className="flex-1 overflow-y-auto">
          {loadingDetail ? (
            <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</div>
          ) : !detail ? (
            <div className="py-20 text-center text-sm text-gray-300">Select a message</div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="px-5 py-3 border-b dark:border-gray-700 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">{detail.subject || '(no subject)'}</h2>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={startReply} title="Reply" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"><Reply size={15} /></button>
                    <button onClick={() => archive(detail.id)} title="Archive" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"><Archive size={15} /></button>
                    <div className="relative">
                      <button onClick={() => setShowMove(v => !v)} title="Move to folder" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"><FolderInput size={15} /></button>
                      {showMove && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowMove(false)} />
                          <div className="absolute right-0 top-full mt-1 z-50 w-56 max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5 py-1">
                            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Move to</p>
                            {userLabels.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No folders yet</p>}
                            {userLabels.map(l => (
                              <button key={l.id} onClick={() => moveTo(detail.id, l.id, l.name)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">
                                <Tag size={13} className="text-gray-400" /> <span className="truncate">{l.name}</span>
                              </button>
                            ))}
                            <button onClick={() => moveToNewFolder(detail.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-amazon-blue hover:bg-gray-50 dark:hover:bg-white/5 border-t border-gray-100 dark:border-white/5 mt-1 pt-2">
                              <FolderPlus size={13} /> New folder…
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <button onClick={() => markUnread(detail.id)} title="Mark unread" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"><MailOpen size={15} /></button>
                    <button onClick={() => trash(detail.id)} title="Trash" className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 hover:text-red-500"><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-medium text-gray-700 dark:text-gray-200">{parseFrom(detail.from).name}</span> &lt;{parseFrom(detail.from).email}&gt; · {fmtDate(detail.date)}
                </div>
                <div className="text-[11px] text-gray-400">to {detail.to}{detail.cc ? ` · cc ${detail.cc}` : ''}</div>
                {detail.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detail.attachments.map((a, i) => {
                      const canPreview = (a.mimeType || '').startsWith('image/') || a.mimeType === 'application/pdf'
                      return (
                        <button key={i} onClick={() => openAttachment(detail.id, a)} disabled={attLoading === a.attachmentId}
                          title={canPreview ? 'Preview' : 'Download'}
                          className="inline-flex items-center gap-1 text-[11px] bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-white/20 disabled:opacity-50">
                          {attLoading === a.attachmentId ? <Loader2 size={10} className="animate-spin" /> : canPreview ? <Paperclip size={10} /> : <Download size={10} />}
                          {a.filename}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <iframe
                title="message"
                sandbox=""
                className="flex-1 w-full bg-white"
                srcDoc={wrapEmailHtml(detail.html, detail.text)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Admin: manage mailboxes & assignments */}
      {showMailboxes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowMailboxes(false)}>
          <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Mailboxes</h3>
              <button onClick={() => setShowMailboxes(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white"><X size={16} /></button>
            </div>
            <div className="px-4 py-3 overflow-y-auto">
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">Assign each mailbox to the user who should see its mail. Only that user (and admins) can read it. The user also needs <span className="font-semibold">Mail On</span> in Settings → Users.</p>
              {accounts.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No mailboxes connected</p>
              ) : accounts.map(a => (
                <div key={a.id} className="flex items-center gap-2 py-2 border-b dark:border-gray-800 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{a.email}</div>
                    <select
                      value={a.assignedUserId ?? ''}
                      onChange={e => assignMailbox(a.id, e.target.value || null)}
                      className="mt-1 h-7 w-full rounded border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-1.5 text-xs text-gray-800 dark:text-gray-200"
                    >
                      <option value="">— Unassigned —</option>
                      {siteUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email}){u.canAccessMail ? '' : ' · Mail Off'}</option>)}
                    </select>
                  </div>
                  <button onClick={() => disconnectMailbox(a.id, a.email)} title="Disconnect mailbox" className="shrink-0 p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={14} /></button>
                </div>
              ))}
              <a href="/api/email/google/connect" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-amazon-blue hover:underline"><Plus size={13} /> Connect another mailbox</a>
            </div>
          </div>
        </div>
      )}

      {/* Attachment preview */}
      {attPreview && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/80" onClick={closePreview}>
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 text-white shrink-0" onClick={e => e.stopPropagation()}>
            <span className="text-sm font-medium truncate flex items-center gap-2"><Paperclip size={14} /> {attPreview.filename}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => triggerDownload(attPreview.url, attPreview.filename)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm font-medium"><Download size={15} /> Download</button>
              <button onClick={closePreview} className="p-1.5 rounded-md hover:bg-white/10"><X size={18} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-auto flex items-center justify-center p-4" onClick={closePreview}>
            {attPreview.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={attPreview.url} alt={attPreview.filename} className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
            ) : (
              <iframe src={attPreview.url} title={attPreview.filename} className="w-full h-full bg-white rounded" onClick={e => e.stopPropagation()} />
            )}
          </div>
        </div>
      )}

      {/* AI rule creation */}
      {showRules && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowRules(false)}>
          <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5"><Sparkles size={15} className="text-amazon-blue" /> Create a rule</h3>
              <button onClick={() => setShowRules(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white"><X size={16} /></button>
            </div>
            <div className="px-4 py-3 space-y-3 overflow-y-auto">
              {isAdmin && !aiConfigured && (
                <div className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 space-y-2">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Add your Anthropic API key to enable AI rules</p>
                  <p className="text-[11px] text-amber-700 dark:text-amber-300/90">Get one at console.anthropic.com → API keys. Stored encrypted.</p>
                  <div className="flex items-center gap-2">
                    <input type="password" value={aiKey} onChange={e => setAiKey(e.target.value)} placeholder="sk-ant-…" className="flex-1 h-8 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2.5 text-sm font-mono text-gray-900 dark:text-white" />
                    <button onClick={saveAiKey} disabled={aiSaving} className="h-8 px-3 rounded-md bg-amazon-blue text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">{aiSaving ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">Describe what you want in plain English. Example: <span className="italic">&quot;Put all emails from anyone at @pcsww.com into a folder called PCS.&quot;</span></p>
              <textarea value={ruleText} onChange={e => setRuleText(e.target.value)} rows={3} placeholder="Type your rule…"
                className="w-full rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2.5 py-2 text-sm text-gray-900 dark:text-white resize-none" />
              <button onClick={interpretRule} disabled={ruleBusy || !ruleText.trim()} className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md bg-amazon-blue text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">
                {ruleBusy && !ruleResult ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Interpret
              </button>

              {ruleResult?.needsClarification && (
                <div className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  {ruleResult.needsClarification}
                </div>
              )}

              {ruleResult?.understanding && !ruleResult?.needsClarification && (
                <div className="rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-2.5 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Here&apos;s what I&apos;ll do</p>
                  <p className="text-sm text-gray-800 dark:text-gray-200">{ruleResult.understanding}</p>
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={applyRule} disabled={ruleBusy} className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40">
                      {ruleBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Confirm & create rule
                    </button>
                    <button onClick={() => setRuleResult(null)} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Edit</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Compose */}
      {compose && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setCompose(null)}>
          <div className="w-full sm:max-w-2xl bg-white dark:bg-gray-900 rounded-t-xl sm:rounded-xl shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()} onKeyDown={composeKeyDown}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{compose.threadId ? 'Reply' : 'New message'}</h3>
              <button onClick={() => setCompose(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white"><X size={16} /></button>
            </div>
            <div className="px-4 py-3 space-y-2">
              <RecipientInput emails={compose.to} onChange={to => setCompose(c => c ? { ...c, to } : c)} onPending={t => { composeToPending.current = t }} contacts={contacts} placeholder="To" />
              <RecipientInput emails={compose.cc} onChange={cc => setCompose(c => c ? { ...c, cc } : c)} contacts={contacts} placeholder="Cc (optional)" />
              <input value={compose.subject} onChange={e => setCompose({ ...compose, subject: e.target.value })} placeholder="Subject" className="w-full h-9 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2.5 text-sm text-gray-900 dark:text-white" />
              <textarea value={compose.body} onChange={e => setCompose({ ...compose, body: e.target.value })} rows={10} placeholder="Write your message…" className="w-full rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2.5 py-2 text-sm text-gray-900 dark:text-white resize-none" />
              {compose.attachments && compose.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {compose.attachments.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200 pl-2 pr-1 py-0.5 rounded">
                      <Paperclip size={10} /> {a.filename} <span className="text-gray-400">({(a.size / 1024).toFixed(0)} KB)</span>
                      <button onClick={() => setCompose(c => c ? { ...c, attachments: c.attachments?.filter((_, j) => j !== i) } : c)} className="text-gray-400 hover:text-red-500"><X size={11} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" multiple hidden onChange={e => addFiles(e.target.files)} />
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t dark:border-gray-700">
              <button onClick={() => fileInputRef.current?.click()} title="Attach files" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-300 dark:border-white/15 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5">
                <Paperclip size={15} /> Attach
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setCompose(null)} className="h-9 px-4 rounded-md border border-gray-300 dark:border-white/15 text-sm text-gray-600 dark:text-gray-300">Discard</button>
                <button onClick={sendMail} disabled={sending} title="Send (⌘/Ctrl + Enter)" className="inline-flex items-center gap-1.5 h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
