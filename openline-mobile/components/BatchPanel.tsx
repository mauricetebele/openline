import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

interface Props {
  selectedCount: number
  onClear: () => void
  onProcess: () => void
}

export function BatchPanel({ selectedCount, onClear, onProcess }: Props) {
  if (selectedCount === 0) return null

  return (
    <View style={styles.container}>
      <Text style={styles.count}>
        {selectedCount} order{selectedCount !== 1 ? 's' : ''} selected
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.clearBtn} onPress={onClear}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.processBtn} onPress={onProcess}>
          <Text style={styles.processText}>Process</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16213e',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  count: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  clearBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  clearText: { color: '#888', fontWeight: '500' },
  processBtn: {
    backgroundColor: '#4361ee',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  processText: { color: '#fff', fontWeight: '600' },
})
