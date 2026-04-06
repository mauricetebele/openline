import { createContext, useContext } from 'react'
import type { AuthUser, Account } from '@/lib/types'

export interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  selectedAccountId: string | null
  accounts: Account[]
  setSelectedAccountId: (id: string) => void
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  selectedAccountId: null,
  accounts: [],
  setSelectedAccountId: () => {},
  login: async () => {},
  logout: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}
