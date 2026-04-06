import auth from '@react-native-firebase/auth'
import { setToken, clearToken } from './storage'
import { apiFetch } from './api'
import type { AuthUser } from './types'

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const credential = await auth().signInWithEmailAndPassword(email, password)
  const idToken = await credential.user.getIdToken()

  // Create session on backend (also stores cookie for web compat) and get token back
  const data = await apiFetch<{ ok: boolean; token: string }>('/api/auth/session', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  })

  // Store the Firebase ID token for subsequent API calls
  await setToken(data.token)

  // Fetch user info
  const { user } = await apiFetch<{ user: AuthUser }>('/api/auth/session')
  return user
}

export async function signOut(): Promise<void> {
  await auth().signOut()
  await clearToken()
}

/** Refresh the Firebase ID token and update storage */
export async function refreshToken(): Promise<string | null> {
  const currentUser = auth().currentUser
  if (!currentUser) return null
  const idToken = await currentUser.getIdToken(true)
  await setToken(idToken)
  return idToken
}

/** Check if there's a valid session by calling the GET endpoint */
export async function validateSession(): Promise<AuthUser | null> {
  try {
    const { user } = await apiFetch<{ user: AuthUser }>('/api/auth/session')
    return user
  } catch {
    return null
  }
}
