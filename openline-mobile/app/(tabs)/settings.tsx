import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { useAuth } from '@/hooks/useAuth'
import Constants from 'expo-constants'

export default function SettingsTab() {
  const { user, accounts, selectedAccountId, setSelectedAccountId, logout } = useAuth()

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ])
  }

  return (
    <View style={styles.container}>
      {/* User Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <Text style={styles.userRole}>{user?.role}</Text>
        </View>
      </View>

      {/* Account Picker */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Marketplace Account</Text>
        {accounts.map((account) => (
          <TouchableOpacity
            key={account.id}
            style={[
              styles.accountRow,
              account.id === selectedAccountId && styles.accountRowActive,
            ]}
            onPress={() => setSelectedAccountId(account.id)}
          >
            <View>
              <Text style={styles.accountName}>
                {account.marketplaceName || account.sellerId}
              </Text>
              <Text style={styles.accountMeta}>
                {account.sellerId} · {account.region}
              </Text>
            </View>
            {account.id === selectedAccountId && (
              <Text style={styles.checkmark}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Version */}
      <Text style={styles.version}>
        OpenLine Mobile v{Constants.expoConfig?.version ?? '1.0.0'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  userName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  userEmail: {
    color: '#888',
    fontSize: 14,
    marginTop: 4,
  },
  userRole: {
    color: '#4361ee',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  accountRowActive: {
    borderColor: '#4361ee',
    backgroundColor: '#1a2548',
  },
  accountName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  accountMeta: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  checkmark: {
    color: '#4361ee',
    fontSize: 18,
    fontWeight: '700',
  },
  logoutBtn: {
    backgroundColor: '#dc2626',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  logoutText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  version: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 'auto',
    paddingBottom: 20,
  },
})
