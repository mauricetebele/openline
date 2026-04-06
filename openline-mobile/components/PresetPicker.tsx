import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal, FlatList } from 'react-native'
import { apiFetch } from '@/lib/api'
import type { PackagePreset } from '@/lib/types'

interface Props {
  selectedPresetId: string | null
  onSelect: (preset: PackagePreset) => void
}

export function PresetPicker({ selectedPresetId, onSelect }: Props) {
  const [presets, setPresets] = useState<PackagePreset[]>([])
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    apiFetch<PackagePreset[]>('/api/package-presets')
      .then(setPresets)
      .catch((err) => console.error('Failed to load presets:', err))
  }, [])

  const selected = presets.find((p) => p.id === selectedPresetId)

  return (
    <View>
      <TouchableOpacity style={styles.picker} onPress={() => setShowModal(true)}>
        <Text style={styles.pickerLabel}>Package Preset</Text>
        <Text style={styles.pickerValue}>
          {selected?.name ?? 'Select preset...'}
        </Text>
      </TouchableOpacity>

      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Preset</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={presets}
              keyExtractor={(p) => p.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.presetRow,
                    item.id === selectedPresetId && styles.presetRowActive,
                  ]}
                  onPress={() => {
                    onSelect(item)
                    setShowModal(false)
                  }}
                >
                  <Text style={styles.presetName}>{item.name}</Text>
                  <Text style={styles.presetMeta}>
                    {item.weightValue} {item.weightUnit}
                    {item.dimLength ? ` · ${item.dimLength}x${item.dimWidth}x${item.dimHeight} ${item.dimUnit}` : ''}
                  </Text>
                  {item.isDefault && <Text style={styles.defaultTag}>Default</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  picker: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  pickerLabel: { color: '#666', fontSize: 12, marginBottom: 4 },
  pickerValue: { color: '#fff', fontSize: 15, fontWeight: '500' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
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
  presetRow: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#16213e',
  },
  presetRowActive: {
    backgroundColor: '#16213e',
  },
  presetName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  presetMeta: { color: '#888', fontSize: 12, marginTop: 2 },
  defaultTag: { color: '#4ade80', fontSize: 11, fontWeight: '700', marginTop: 4 },
})
