import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native'
import { apiFetch } from '@/lib/api'
import type { WholesaleOrder } from '@/lib/types'

const STATUS_FILTERS = ['All', 'PENDING', 'PROCESSING', 'SHIPPED'] as const

export default function WholesaleTab() {
  const [orders, setOrders] = useState<WholesaleOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('All')
  const [detailOrder, setDetailOrder] = useState<WholesaleOrder | null>(null)

  const fetchOrders = useCallback(async () => {
    try {
      const params = statusFilter !== 'All' ? `?status=${statusFilter}` : ''
      const data = await apiFetch<{ orders: WholesaleOrder[] }>(
        `/api/wholesale/orders${params}`,
      )
      setOrders(data.orders)
    } catch (err) {
      console.error('Failed to fetch wholesale orders:', err)
    }
  }, [statusFilter])

  useEffect(() => {
    setLoading(true)
    fetchOrders().finally(() => setLoading(false))
  }, [fetchOrders])

  const refresh = async () => {
    setRefreshing(true)
    await fetchOrders()
    setRefreshing(false)
  }

  return (
    <View style={styles.container}>
      {/* Status Chips */}
      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.chip, statusFilter === s && styles.chipActive]}
            onPress={() => setStatusFilter(s)}
          >
            <Text style={[styles.chipText, statusFilter === s && styles.chipTextActive]}>
              {s === 'All' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4361ee" />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          refreshing={refreshing}
          onRefresh={refresh}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => setDetailOrder(item)}
              activeOpacity={0.7}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.orderNum}>{item.orderNumber}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.customer}>{item.customer?.companyName}</Text>
              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>
                  {item.items?.length ?? 0} item{(item.items?.length ?? 0) !== 1 ? 's' : ''}
                </Text>
                {item.customerPoNumber && (
                  <Text style={styles.metaText}>PO: {item.customerPoNumber}</Text>
                )}
                {item.total != null && (
                  <Text style={styles.totalText}>${item.total.toFixed(2)}</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={orders.length === 0 ? styles.emptyList : undefined}
          ListEmptyComponent={<Text style={styles.emptyText}>No wholesale orders</Text>}
        />
      )}

      {/* Detail Modal */}
      <Modal visible={!!detailOrder} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{detailOrder?.orderNumber}</Text>
              <TouchableOpacity onPress={() => setDetailOrder(null)}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>
            {detailOrder && (
              <ScrollView style={styles.modalBody}>
                <InfoRow label="Customer" value={detailOrder.customer?.companyName ?? '—'} />
                <InfoRow label="Status" value={detailOrder.status} />
                <InfoRow label="PO Number" value={detailOrder.customerPoNumber ?? '—'} />
                <InfoRow
                  label="Order Date"
                  value={new Date(detailOrder.orderDate).toLocaleDateString()}
                />
                {detailOrder.notes && <InfoRow label="Notes" value={detailOrder.notes} />}

                <Text style={styles.itemsTitle}>Line Items</Text>
                {detailOrder.items?.map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <Text style={styles.itemName}>{item.productName}</Text>
                    <Text style={styles.itemDetail}>
                      SKU: {item.sku} · Qty: {item.quantity} · ${item.unitPrice.toFixed(2)}
                    </Text>
                  </View>
                ))}

                {detailOrder.total != null && (
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalAmount}>${detailOrder.total.toFixed(2)}</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: '#f59e0b',
    PROCESSING: '#3b82f6',
    SHIPPED: '#4ade80',
  }
  return (
    <View style={[styles.badge, { backgroundColor: colors[status] ?? '#888' }]}>
      <Text style={styles.badgeText}>{status}</Text>
    </View>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterRow: { flexDirection: 'row', padding: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#16213e',
  },
  chipActive: { backgroundColor: '#4361ee' },
  chipText: { color: '#888', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  card: {
    backgroundColor: '#16213e',
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderNum: { color: '#fff', fontSize: 15, fontWeight: '700' },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  customer: { color: '#ccc', fontSize: 14, marginTop: 4 },
  cardMeta: { flexDirection: 'row', gap: 12, marginTop: 6 },
  metaText: { color: '#666', fontSize: 12 },
  totalText: { color: '#4ade80', fontSize: 12, fontWeight: '600' },
  emptyList: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  closeText: { color: '#4361ee', fontSize: 15 },
  modalBody: { padding: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  infoLabel: { color: '#666', fontSize: 13 },
  infoValue: { color: '#ccc', fontSize: 14, fontWeight: '500' },
  itemsTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 10 },
  itemRow: {
    backgroundColor: '#0f1629',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  itemName: { color: '#fff', fontSize: 13, fontWeight: '500' },
  itemDetail: { color: '#888', fontSize: 12, marginTop: 4 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  totalLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  totalAmount: { color: '#4ade80', fontSize: 18, fontWeight: '700' },
})
