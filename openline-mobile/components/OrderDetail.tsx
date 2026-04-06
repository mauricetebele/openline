import { useCallback, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ScrollView } from 'react-native'
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet'
import { apiFetch } from '@/lib/api'
import type { Order, OrderItem } from '@/lib/types'

interface Props {
  order: Order | null
  bottomSheetRef: React.RefObject<BottomSheet | null>
  onDismiss: () => void
  onItemUpdated: () => void
}

export function OrderDetail({ order, bottomSheetRef, onDismiss, onItemUpdated }: Props) {
  const snapPoints = useMemo(() => ['50%', '85%'], [])
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [editSku, setEditSku] = useState('')
  const [editGrade, setEditGrade] = useState('')

  const startEdit = (item: OrderItem) => {
    setEditingItem(item.id)
    setEditSku(item.sku)
    setEditGrade(item.grade ?? '')
  }

  const saveEdit = async () => {
    if (!order || !editingItem) return
    try {
      await apiFetch(`/api/orders/${order.id}/items/${editingItem}`, {
        method: 'PATCH',
        body: JSON.stringify({ sku: editSku, grade: editGrade || null }),
      })
      setEditingItem(null)
      onItemUpdated()
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update item')
    }
  }

  const handleSheetChanges = useCallback(
    (index: number) => {
      if (index === -1) onDismiss()
    },
    [onDismiss],
  )

  if (!order) return null

  const shipBy = order.latestShipDate
    ? new Date(order.latestShipDate).toLocaleDateString()
    : '—'

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={-1}
      snapPoints={snapPoints}
      onChange={handleSheetChanges}
      enablePanDownToClose
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.indicator}
    >
      <BottomSheetView style={styles.content}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.olmNumber}>{order.olmNumber}</Text>
            <Text style={styles.status}>{order.workflowStatus}</Text>
          </View>

          <View style={styles.infoRow}>
            <InfoItem label="Buyer" value={order.buyerName || 'Unknown'} />
            <InfoItem label="Total" value={`$${order.orderTotal?.toFixed(2)}`} />
          </View>
          <View style={styles.infoRow}>
            <InfoItem label="Ship By" value={shipBy} />
            <InfoItem label="Source" value={order.source === 'BACKMARKET' ? 'Back Market' : 'Amazon'} />
          </View>

          {order.shippingAddress && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Shipping Address</Text>
              <Text style={styles.addressText}>
                {order.shippingAddress.name}{'\n'}
                {order.shippingAddress.line1}
                {order.shippingAddress.line2 ? `\n${order.shippingAddress.line2}` : ''}{'\n'}
                {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}
              </Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Items ({order.items?.length ?? 0})</Text>
            {order.items?.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                {editingItem === item.id ? (
                  <View style={styles.editForm}>
                    <TextInput
                      style={styles.editInput}
                      value={editSku}
                      onChangeText={setEditSku}
                      placeholder="SKU"
                      placeholderTextColor="#666"
                    />
                    <TextInput
                      style={styles.editInput}
                      value={editGrade}
                      onChangeText={setEditGrade}
                      placeholder="Grade"
                      placeholderTextColor="#666"
                    />
                    <View style={styles.editActions}>
                      <TouchableOpacity style={styles.saveBtn} onPress={saveEdit}>
                        <Text style={styles.saveBtnText}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingItem(null)}>
                        <Text style={styles.cancelText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.itemContent}
                    onPress={() => startEdit(item)}
                  >
                    <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
                    <View style={styles.itemMeta}>
                      <Text style={styles.itemSku}>SKU: {item.sku}</Text>
                      {item.grade && <Text style={styles.itemGrade}>Grade: {item.grade}</Text>}
                      <Text style={styles.itemQty}>Qty: {item.quantity}</Text>
                      <Text style={styles.itemPrice}>${item.itemPrice?.toFixed(2)}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </BottomSheetView>
    </BottomSheet>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: '#1a1a2e' },
  indicator: { backgroundColor: '#555' },
  content: { flex: 1, paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  olmNumber: { color: '#fff', fontSize: 20, fontWeight: '700' },
  status: { color: '#4361ee', fontSize: 13, fontWeight: '600' },
  infoRow: { flexDirection: 'row', marginBottom: 12, gap: 16 },
  infoItem: { flex: 1 },
  infoLabel: { color: '#666', fontSize: 12, marginBottom: 2 },
  infoValue: { color: '#ccc', fontSize: 14, fontWeight: '500' },
  section: { marginTop: 16 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 10 },
  addressText: { color: '#ccc', fontSize: 14, lineHeight: 20 },
  itemRow: {
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  itemContent: {},
  itemTitle: { color: '#fff', fontSize: 14, fontWeight: '500', marginBottom: 6 },
  itemMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  itemSku: { color: '#888', fontSize: 12 },
  itemGrade: { color: '#f59e0b', fontSize: 12 },
  itemQty: { color: '#888', fontSize: 12 },
  itemPrice: { color: '#4ade80', fontSize: 12, fontWeight: '600' },
  editForm: { gap: 8 },
  editInput: {
    backgroundColor: '#0f1629',
    color: '#fff',
    padding: 10,
    borderRadius: 8,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  saveBtn: {
    backgroundColor: '#4361ee',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '600' },
  cancelText: { color: '#888', fontSize: 14 },
})
