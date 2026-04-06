import { useEffect, useState, useCallback } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { StyleSheet } from 'react-native'
import { AuthContext } from '@/hooks/useAuth'
import { signIn, signOut, validateSession } from '@/lib/auth'
import { apiFetch } from '@/lib/api'
import { getToken, getSelectedAccountId, setSelectedAccountId as saveAccountId } from '@/lib/storage'
import type { AuthUser, Account } from '@/lib/types'

export default function RootLayout() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(null)

  const router = useRouter()
  const segments = useSegments()

  // Check for existing session on mount
  useEffect(() => {
    ;(async () => {
      const token = await getToken()
      if (token) {
        const u = await validateSession()
        if (u) {
          setUser(u)
          await loadAccounts()
        }
      }
      setLoading(false)
    })()
  }, [])

  // Redirect based on auth state
  useEffect(() => {
    if (loading) return
    const inAuthGroup = segments[0] === '(tabs)'

    if (!user && inAuthGroup) {
      router.replace('/login')
    } else if (user && !inAuthGroup && segments[0] !== '(tabs)') {
      router.replace('/(tabs)')
    }
  }, [user, segments, loading])

  const loadAccounts = useCallback(async () => {
    try {
      const data = await apiFetch<Account[]>('/api/accounts')
      setAccounts(data)
      const savedId = await getSelectedAccountId()
      if (savedId && data.some((a) => a.id === savedId)) {
        setSelectedAccountIdState(savedId)
      } else if (data.length > 0) {
        setSelectedAccountIdState(data[0].id)
        await saveAccountId(data[0].id)
      }
    } catch (err) {
      console.error('Failed to load accounts:', err)
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const u = await signIn(email, password)
    setUser(u)
    await loadAccounts()
  }, [loadAccounts])

  const logout = useCallback(async () => {
    await signOut()
    setUser(null)
    setAccounts([])
    setSelectedAccountIdState(null)
  }, [])

  const handleSetAccountId = useCallback(async (id: string) => {
    setSelectedAccountIdState(id)
    await saveAccountId(id)
  }, [])

  return (
    <GestureHandlerRootView style={styles.root}>
      <AuthContext.Provider
        value={{
          user,
          loading,
          selectedAccountId,
          accounts,
          setSelectedAccountId: handleSetAccountId,
          login,
          logout,
        }}
      >
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="login" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </AuthContext.Provider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
