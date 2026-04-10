'use client'

import { useState, useEffect, useCallback } from 'react'
import AppShell from '@/components/AppShell'
import { Bell, CheckCheck, AlertTriangle, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'

interface Alert {
  id: string
  type: string
  title: string
  message: string
  metadata: Record<string, string> | null
  readAt: string | null
  createdAt: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: typeof AlertTriangle }> = {
  RETURN_ICLOUD_ON: {
    label: 'iCloud ON',
    color: 'bg-red-500/10 text-red-400 border-red-500/20',
    icon: AlertTriangle,
  },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const fetchAlerts = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/alerts?page=${p}&limit=25`)
      if (!res.ok) return
      const data = await res.json()
      setAlerts(data.data)
      setPagination(data.pagination)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAlerts(page) }, [page, fetchAlerts])

  async function markAllRead() {
    await fetch('/api/alerts/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    setAlerts(prev => prev.map(a => ({ ...a, readAt: a.readAt ?? new Date().toISOString() })))
  }

  async function markOneRead(id: string) {
    await fetch('/api/alerts/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    })
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, readAt: new Date().toISOString() } : a))
  }

  const unreadCount = alerts.filter(a => !a.readAt).length

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Bell size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">Alerts</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {pagination?.total ?? 0} total{unreadCount > 0 && ` · ${unreadCount} unread`}
              </p>
            </div>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
            >
              <CheckCheck size={16} />
              Mark All Read
            </button>
          )}
        </div>

        {/* Alert list */}
        <div className="space-y-2">
          {loading && alerts.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
          ) : alerts.length === 0 ? (
            <div className="text-center py-12">
              <Bell size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
              <p className="text-gray-500 dark:text-gray-400 font-medium">No alerts yet</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                Alerts will appear here when notable events occur
              </p>
            </div>
          ) : (
            alerts.map(alert => {
              const cfg = TYPE_CONFIG[alert.type] ?? {
                label: alert.type,
                color: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
                icon: Bell,
              }
              const Icon = cfg.icon
              const isUnread = !alert.readAt

              return (
                <button
                  key={alert.id}
                  onClick={() => isUnread && markOneRead(alert.id)}
                  className={clsx(
                    'w-full text-left flex items-start gap-3 p-4 rounded-xl border transition-all',
                    isUnread
                      ? 'bg-white dark:bg-white/[0.04] border-gray-200 dark:border-white/10 shadow-sm hover:shadow-md'
                      : 'bg-gray-50 dark:bg-white/[0.02] border-gray-100 dark:border-white/5 opacity-70',
                  )}
                >
                  {/* Unread dot */}
                  <div className="pt-1.5 shrink-0">
                    <div className={clsx(
                      'w-2.5 h-2.5 rounded-full',
                      isUnread ? 'bg-blue-500' : 'bg-transparent',
                    )} />
                  </div>

                  {/* Icon */}
                  <div className={clsx('mt-0.5 p-2 rounded-lg border shrink-0', cfg.color)}>
                    <Icon size={16} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={clsx(
                        'text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border',
                        cfg.color,
                      )}>
                        {cfg.label}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        <Clock size={11} />
                        {timeAgo(alert.createdAt)}
                      </span>
                    </div>
                    <p className={clsx(
                      'text-sm font-medium',
                      isUnread ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300',
                    )}>
                      {alert.title}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{alert.message}</p>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Page {page} of {pagination.totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={page >= pagination.totalPages}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
    </AppShell>
  )
}
