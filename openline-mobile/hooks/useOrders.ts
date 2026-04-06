import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import type { Order, OrderCounts, TabFilter } from '@/lib/types'
import { useAuth } from './useAuth'

export function useOrders(tab: TabFilter) {
  const { selectedAccountId } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [counts, setCounts] = useState<OrderCounts>({ pending: 0, unshipped: 0, awaiting: 0, shipped: 0 })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchOrders = useCallback(async () => {
    if (!selectedAccountId) return
    try {
      const data = await apiFetch<{ orders: Order[]; total: number }>(
        `/api/orders?accountId=${selectedAccountId}&tab=${tab}&pageSize=100`,
      )
      setOrders(data.orders)
    } catch (err) {
      console.error('Failed to fetch orders:', err)
    }
  }, [selectedAccountId, tab])

  const fetchCounts = useCallback(async () => {
    if (!selectedAccountId) return
    try {
      const data = await apiFetch<OrderCounts>(
        `/api/orders/counts?accountId=${selectedAccountId}`,
      )
      setCounts(data)
    } catch (err) {
      console.error('Failed to fetch counts:', err)
    }
  }, [selectedAccountId])

  const load = useCallback(async () => {
    setLoading(true)
    await Promise.all([fetchOrders(), fetchCounts()])
    setLoading(false)
  }, [fetchOrders, fetchCounts])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([fetchOrders(), fetchCounts()])
    setRefreshing(false)
  }, [fetchOrders, fetchCounts])

  useEffect(() => {
    load()
  }, [load])

  return { orders, counts, loading, refreshing, refresh }
}
