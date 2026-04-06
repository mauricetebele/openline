import { useState, useRef, useCallback } from 'react'
import { View, FlatList, StyleSheet, ActivityIndicator, Text } from 'react-native'
import BottomSheet from '@gorhom/bottom-sheet'
import { useRouter } from 'expo-router'
import { useAuth } from '@/hooks/useAuth'
import { useOrders } from '@/hooks/useOrders'
import { FilterBar } from '@/components/FilterBar'
import { OrderCard } from '@/components/OrderCard'
import { OrderDetail } from '@/components/OrderDetail'
import { BatchPanel } from '@/components/BatchPanel'
import type { TabFilter, Order } from '@/lib/types'

export default function OrdersTab() {
  const { selectedAccountId } = useAuth()
  const [tab, setTab] = useState<TabFilter>('pending')
  const { orders, counts, loading, refreshing, refresh } = useOrders(tab)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const bottomSheetRef = useRef<BottomSheet>(null)
  const router = useRouter()

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const openDetail = useCallback((order: Order) => {
    setDetailOrder(order)
    bottomSheetRef.current?.snapToIndex(0)
  }, [])

  const handleProcess = useCallback(() => {
    const ids = Array.from(selectedIds)
    router.push({ pathname: '/(tabs)/process', params: { orderIds: ids.join(',') } })
  }, [selectedIds, router])

  if (!selectedAccountId) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Select an account in Settings</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <FilterBar active={tab} counts={counts} onSelect={setTab} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4361ee" />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              selected={selectedIds.has(item.id)}
              onPress={() => openDetail(item)}
              onLongPress={() => toggleSelect(item.id)}
            />
          )}
          refreshing={refreshing}
          onRefresh={refresh}
          contentContainerStyle={orders.length === 0 ? styles.emptyList : undefined}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No orders</Text>
          }
        />
      )}

      <BatchPanel
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        onProcess={handleProcess}
      />

      <OrderDetail
        order={detailOrder}
        bottomSheetRef={bottomSheetRef}
        onDismiss={() => setDetailOrder(null)}
        onItemUpdated={refresh}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
  },
})
