import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import type { Order } from '@/lib/types'

interface Props {
  order: Order
  selected: boolean
  onPress: () => void
  onLongPress: () => void
}

export function OrderCard({ order, selected, onPress, onLongPress }: Props) {
  const sourceIcon = order.source === 'BACKMARKET' ? 'BM' : 'AMZ'
  const shipBy = order.latestShipDate
    ? new Date(order.latestShipDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—'
  const total = order.orderTotal?.toFixed(2) ?? '0.00'
  const itemCount = order.items?.length ?? 0

  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      <View style={styles.row}>
        <View style={styles.left}>
          <View style={styles.headerRow}>
            <Text style={styles.olmNumber}>{order.olmNumber}</Text>
            <View style={[styles.sourceBadge, order.source === 'BACKMARKET' && styles.sourceBM]}>
              <Text style={styles.sourceText}>{sourceIcon}</Text>
            </View>
          </View>
          <Text style={styles.buyerName} numberOfLines={1}>
            {order.buyerName || 'Unknown'}
          </Text>
          <Text style={styles.meta}>
            {itemCount} item{itemCount !== 1 ? 's' : ''} · Ship by {shipBy}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={styles.total}>${total}</Text>
          {order.presetRateAmount != null && (
            <Text style={styles.rate}>
              ${order.presetRateAmount.toFixed(2)} {order.presetRateCarrier}
            </Text>
          )}
        </View>
      </View>
      {selected && <View style={styles.checkmark}><Text style={styles.checkmarkText}>✓</Text></View>}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#16213e',
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  cardSelected: {
    borderColor: '#4361ee',
    backgroundColor: '#1a2548',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  left: {
    flex: 1,
    marginRight: 12,
  },
  right: {
    alignItems: 'flex-end',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  olmNumber: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  sourceBadge: {
    backgroundColor: '#ff9900',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  sourceBM: {
    backgroundColor: '#00b4d8',
  },
  sourceText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  buyerName: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 2,
  },
  meta: {
    color: '#666',
    fontSize: 12,
  },
  total: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  rate: {
    color: '#4ade80',
    fontSize: 12,
    marginTop: 2,
  },
  checkmark: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  checkmarkText: {
    color: '#4361ee',
    fontSize: 18,
    fontWeight: '700',
  },
})
