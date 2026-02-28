/**
 * Firebase Auth via REST API — no firebase npm package needed on the client.
 * Docs: https://firebase.google.com/docs/reference/rest/auth
 */

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!
const BASE = 'https://identitytoolkit.googleapis.com/v1/accounts'

export interface FirebaseUser {
  uid: string
  email: string
  displayName: string | null
}

export interface SignInResult {
  idToken: string
  email: string
  displayName: string
  localId: string
  expiresIn: string
}

/** Sign in with email + password. Returns the Firebase ID token on success. */
export async function signInWithEmail(email: string, password: string): Promise<SignInResult> {
  const res = await fetch(`${BASE}:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })

  const data = await res.json()

  if (!res.ok) {
    const code: string = data.error?.message ?? 'UNKNOWN_ERROR'
    if (code.includes('EMAIL_NOT_FOUND') || code.includes('INVALID_PASSWORD') || code.includes('INVALID_LOGIN_CREDENTIALS')) {
      throw Object.assign(new Error('Invalid email or password'), { code: 'auth/invalid-credential' })
    }
    if (code.includes('TOO_MANY_ATTEMPTS')) {
      throw Object.assign(new Error('Too many attempts. Try again later.'), { code: 'auth/too-many-requests' })
    }
    if (code.includes('USER_DISABLED')) {
      throw Object.assign(new Error('This account has been disabled.'), { code: 'auth/user-disabled' })
    }
    throw Object.assign(new Error(code), { code: 'auth/unknown' })
  }

  return data as SignInResult
}
