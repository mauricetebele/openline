import { useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useAuth } from '@/hooks/useAuth'
import { useRateShop } from '@/hooks/useRateShop'
import { PresetPicker } from '@/components/PresetPicker'
import { RateCard } from '@/components/RateCard'
import { apiFetch } from '@/lib/api'
import type { PackagePreset, LabelResult } from '@/lib/types'

export default function ProcessTab() {
  const { selectedAccountId } = useAuth()
  const params = useLocalSearchParams<{ orderIds?: string }>()
  const orderIds = params.orderIds?.split(',').filter(Boolean) ?? []

  const [selectedPreset, setSelectedPreset] = useState<PackagePreset | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyDone, setApplyDone] = useState(false)
  const { rates, done, loading: rateLoading, error: rateError, rateShop, reset } = useRateShop()
  const [labeling, setLabeling] = useState(false)
  const [labelResults, setLabelResults] = useState<LabelResult[]>([])
  const [labelProgress, setLabelProgress] = useState('')

  const handleApplyPreset = useCallback(async () => {
    if (!selectedPreset || !selectedAccountId || orderIds.length === 0) return
    setApplying(true)
    setApplyDone(false)
    reset()
    try {
      await apiFetch('/api/orders/apply-package-preset', {
        method: 'POST',
        body: JSON.stringify({
          presetId: selectedPreset.id,
          orderIds,
          accountId: selectedAccountId,
        }),
      })
      setApplyDone(true)
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to apply preset')
    } finally {
      setApplying(false)
    }
  }, [selectedPreset, selectedAccountId, orderIds, reset])

  const handleRateShop = useCallback(async () => {
    if (!selectedAccountId || orderIds.length === 0) return
    await rateShop(orderIds, selectedAccountId)
  }, [selectedAccountId, orderIds, rateShop])

  const handleCreateLabels = useCallback(async () => {
    if (orderIds.length === 0) return
    setLabeling(true)
    setLabelResults([])
    setLabelProgress(`Creating labels (0/${orderIds.length})...`)
    try {
      const data = await apiFetch<{ results: LabelResult[] }>('/api/orders/label-batch', {
        method: 'POST',
        body: JSON.stringify({ orderIds }),
      })
      setLabelResults(data.results)
      const success = data.results.filter((r) => r.success).length
      setLabelProgress(`Done: ${success}/${data.results.length} succeeded`)
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Label creation failed')
      setLabelProgress('')
    } finally {
      setLabeling(false)
    }
  }, [orderIds])

  if (orderIds.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>
          Select orders on the Orders tab, then tap Process
        </Text>
      </View>
    )
  }

  const rateEntries = Object.values(rates)
  const cheapestRate = rateEntries.reduce<number | null>((min, r) => {
    if (r.rateAmount == null) return min
    return min == null || r.rateAmount < min ? r.rateAmount : min
  }, null)

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>
        Process {orderIds.length} Order{orderIds.length !== 1 ? 's' : ''}
      </Text>

      {/* Step 1: Select Preset */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>1. Package Preset</Text>
        <PresetPicker
          selectedPresetId={selectedPreset?.id ?? null}
          onSelect={setSelectedPreset}
        />
        <TouchableOpacity
          style={[styles.actionBtn, (!selectedPreset || applying) && styles.actionBtnDisabled]}
          onPress={handleApplyPreset}
          disabled={!selectedPreset || applying}
        >
          {applying ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.actionBtnText}>Apply Preset</Text>
          )}
        </TouchableOpacity>
        {applyDone && <Text style={styles.successText}>Preset applied</Text>}
      </View>

      {/* Step 2: Rate Shop */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>2. Rate Shop</Text>
        <TouchableOpacity
          style={[styles.actionBtn, rateLoading && styles.actionBtnDisabled]}
          onPress={handleRateShop}
          disabled={rateLoading}
        >
          {rateLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.actionBtnText}>Rate Shop</Text>
          )}
        </TouchableOpacity>
        {rateError && <Text style={styles.errorText}>{rateError}</Text>}
        {rateEntries.map((rate) => (
          <RateCard
            key={rate.orderId}
            rate={rate}
            isCheapest={rate.rateAmount === cheapestRate}
          />
        ))}
        {done && (
          <Text style={styles.doneText}>
            {done.applied}/{done.total} rated
            {done.skipped ? ` · ${done.skipped} skipped` : ''}
          </Text>
        )}
      </View>

      {/* Step 3: Create Labels */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>3. Create Labels</Text>
        <TouchableOpacity
          style={[styles.actionBtn, styles.labelBtn, labeling && styles.actionBtnDisabled]}
          onPress={handleCreateLabels}
          disabled={labeling}
        >
          {labeling ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.actionBtnText}>Create Labels</Text>
          )}
        </TouchableOpacity>
        {labelProgress ? <Text style={styles.progressText}>{labelProgress}</Text> : null}
        {labelResults.map((r) => (
          <View
            key={r.orderId}
            style={[styles.labelResult, !r.success && styles.labelResultError]}
          >
            <Text style={styles.labelOlm}>{r.olmNumber}</Text>
            {r.success ? (
              <Text style={styles.labelSuccess}>
                {r.carrier} · {r.trackingNumber}
              </Text>
            ) : (
              <Text style={styles.labelError}>{r.error}</Text>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 15, textAlign: 'center', padding: 32 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 20 },
  section: { marginBottom: 28 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  actionBtn: {
    backgroundColor: '#4361ee',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  labelBtn: { backgroundColor: '#059669' },
  successText: { color: '#4ade80', fontSize: 13, marginTop: 8 },
  errorText: { color: '#ef4444', fontSize: 13, marginTop: 8 },
  doneText: { color: '#888', fontSize: 13, marginTop: 8 },
  progressText: { color: '#888', fontSize: 13, marginTop: 8 },
  labelResult: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#4ade80',
  },
  labelResultError: { borderLeftColor: '#ef4444' },
  labelOlm: { color: '#fff', fontSize: 13, fontWeight: '600' },
  labelSuccess: { color: '#4ade80', fontSize: 12, marginTop: 2 },
  labelError: { color: '#ef4444', fontSize: 12, marginTop: 2 },
})
