import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import type { TabFilter, OrderCounts } from '@/lib/types'

const TABS: { key: TabFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'unshipped', label: 'Unshipped' },
  { key: 'awaiting', label: 'Awaiting' },
  { key: 'shipped', label: 'Shipped' },
]

interface Props {
  active: TabFilter
  counts: OrderCounts
  onSelect: (tab: TabFilter) => void
}

export function FilterBar({ active, counts, onSelect }: Props) {
  return (
    <View style={styles.container}>
      {TABS.map(({ key, label }) => (
        <TouchableOpacity
          key={key}
          style={[styles.chip, active === key && styles.chipActive]}
          onPress={() => onSelect(key)}
        >
          <Text style={[styles.chipText, active === key && styles.chipTextActive]}>
            {label}
          </Text>
          <View style={[styles.badge, active === key && styles.badgeActive]}>
            <Text style={[styles.badgeText, active === key && styles.badgeTextActive]}>
              {counts[key]}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#16213e',
    gap: 6,
  },
  chipActive: {
    backgroundColor: '#4361ee',
  },
  chipText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#fff',
  },
  badge: {
    backgroundColor: '#2a2a4a',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 22,
    alignItems: 'center',
  },
  badgeActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  badgeText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: '#fff',
  },
})
