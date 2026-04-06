import { View, Text, StyleSheet } from 'react-native'
import type { RateEvent } from '@/lib/types'

interface Props {
  rate: RateEvent
  isCheapest?: boolean
}

export function RateCard({ rate, isCheapest }: Props) {
  if (rate.error) {
    return (
      <View style={[styles.card, styles.cardError]}>
        <Text style={styles.olmNumber}>{rate.olmNumber}</Text>
        <Text style={styles.errorText}>{rate.error}</Text>
      </View>
    )
  }

  return (
    <View style={[styles.card, isCheapest && styles.cardCheapest]}>
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={styles.olmNumber}>{rate.olmNumber}</Text>
          <Text style={styles.service}>
            {rate.rateCarrier} — {rate.rateService}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={[styles.amount, isCheapest && styles.amountCheapest]}>
            ${rate.rateAmount?.toFixed(2)}
          </Text>
          {isCheapest && <Text style={styles.cheapestTag}>BEST</Text>}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  cardCheapest: {
    borderColor: '#4ade80',
  },
  cardError: {
    borderColor: '#ef4444',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  left: { flex: 1 },
  right: { alignItems: 'flex-end' },
  olmNumber: { color: '#fff', fontSize: 14, fontWeight: '600' },
  service: { color: '#888', fontSize: 12, marginTop: 2 },
  amount: { color: '#fff', fontSize: 16, fontWeight: '700' },
  amountCheapest: { color: '#4ade80' },
  cheapestTag: {
    color: '#4ade80',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },
  errorText: { color: '#ef4444', fontSize: 12, marginTop: 4 },
})
