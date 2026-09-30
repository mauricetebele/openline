'use client'
/**
 * AuthContext — manages auth state using our session cookie + /api/auth/me.
 * No firebase npm package needed. Uses Firebase Auth REST API for sign-in.
 */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useRouter } from 'next/navigation'

export interface AuthUser {
  uid: string
  email: string
  name: string
  role: string
  dbId: string
  canAccessOli: boolean
  canAccessMail: boolean
  canViewPurchaseOrders: boolean
  vendorId: string | null
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  // On mount: ask the server if there is a valid session.
  // If the session cookie is expired/invalid, clear it and send to login.
  useEffect(() => {
    fetch('/api/auth/me')
      .then(async (r) => {
        if (r.status === 401) {
          // Genuinely unauthenticated — clear the stale cookie, then to login.
          await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {})
          router.push('/login')
          return null
        }
        // Transient error (5xx / network) — DON'T nuke a valid session; a reload
        // will recover. Leave the cookie intact.
        if (!r.ok) return null
        return r.json()
      })
      .then((data) => setUser(data ?? null))
      .catch(() => { /* network blip — keep the session, don't force logout */ })
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signOut() {
    await fetch('/api/auth/session', { method: 'DELETE' })
    setUser(null)
    router.push('/login')
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
