'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { auth } from '@/lib/firebase-client'
import {
  signInWithEmailAndPassword,
  MultiFactorError,
  getMultiFactorResolver,
  TotpMultiFactorGenerator,
} from 'firebase/auth'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // MFA state
  const [mfaResolver, setMfaResolver] = useState<ReturnType<typeof getMultiFactorResolver> | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [showMfaStep, setShowMfaStep] = useState(false)

  async function createSession(idToken: string) {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })
    if (!res.ok) throw new Error('Failed to create session')
    const data = await res.json()
    const dest = data.role === 'VENDOR' ? '/vendor/inventory'
      : data.role === 'CLIENT' ? '/client/inventory'
      : data.role === 'RESOLUTION_PROVIDER' ? '/cases'
      : '/refunds'
    router.push(dest)
    router.refresh()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password)
      const idToken = await cred.user.getIdToken()
      await createSession(idToken)
    } catch (err: unknown) {
      const firebaseErr = err as { code?: string; message?: string }

      if (firebaseErr.code === 'auth/multi-factor-auth-required') {
        // MFA enrolled — show TOTP input
        const resolver = getMultiFactorResolver(auth, err as MultiFactorError)
        setMfaResolver(resolver)
        setShowMfaStep(true)
      } else if (firebaseErr.code === 'auth/invalid-credential') {
        toast.error('Invalid email or password')
      } else if (firebaseErr.code === 'auth/too-many-requests') {
        toast.error('Too many attempts. Try again later.')
      } else if (firebaseErr.code === 'auth/user-disabled') {
        toast.error('This account has been disabled.')
      } else {
        console.error('[Login error]', err)
        toast.error(`Sign-in failed: ${firebaseErr.message ?? 'Unknown error'}`)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!mfaResolver) return
    setLoading(true)

    try {
      // Find the TOTP factor hint
      const totpHint = mfaResolver.hints.find(
        (h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID,
      )
      if (!totpHint) {
        toast.error('No TOTP factor found. Contact your admin.')
        return
      }

      const assertion = TotpMultiFactorGenerator.assertionForSignIn(
        totpHint.uid,
        totpCode,
      )
      const cred = await mfaResolver.resolveSignIn(assertion)
      const idToken = await cred.user.getIdToken()
      await createSession(idToken)
    } catch (err: unknown) {
      const firebaseErr = err as { code?: string; message?: string }
      if (firebaseErr.code === 'auth/invalid-verification-code') {
        toast.error('Invalid verification code. Please try again.')
      } else {
        console.error('[MFA error]', err)
        toast.error(`Verification failed: ${firebaseErr.message ?? 'Unknown error'}`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-amazon-dark flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-8 text-center flex flex-col items-center">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 200" fill="none" width={200} height={140} className="mb-2" role="img" aria-label="Open Line Mobility">
            <defs>
              <linearGradient id="lineGrad" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#1B5EA6"/>
                <stop offset="100%" stopColor="#C1342C"/>
              </linearGradient>
            </defs>
            <path d="M60 105 C100 120, 160 40, 210 55" stroke="url(#lineGrad)" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
            <circle cx="58" cy="104" r="10" stroke="#1B5EA6" strokeWidth="3.5" fill="none"/>
            <circle cx="58" cy="104" r="3" fill="#1B5EA6"/>
            <circle cx="212" cy="54" r="11" stroke="#C1342C" strokeWidth="3.5" fill="none"/>
            <circle cx="212" cy="54" r="3.5" fill="#C1342C"/>
            <text x="140" y="148" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="32" fill="#1B3A5C" letterSpacing="3">OPEN LINE</text>
            <text x="140" y="175" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="22" fill="#C1342C" letterSpacing="6">MOBILITY</text>
          </svg>
          <p className="text-gray-500 text-sm">Seller Management Platform</p>
        </div>

        {!showMfaStep ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              className="btn-primary w-full justify-center"
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMfaVerify} className="space-y-4">
            <div className="text-center mb-2">
              <p className="text-sm font-medium text-gray-700">Two-Factor Authentication</p>
              <p className="text-xs text-gray-500 mt-1">
                Enter the 6-digit code from your authenticator app
              </p>
            </div>
            <div>
              <input
                type="text"
                className="input text-center text-lg tracking-[0.3em] font-mono"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                required
                maxLength={6}
                autoFocus
                autoComplete="one-time-code"
                inputMode="numeric"
              />
            </div>
            <button
              type="submit"
              className="btn-primary w-full justify-center"
              disabled={loading || totpCode.length !== 6}
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              className="w-full text-xs text-gray-500 hover:text-gray-700 transition-colors"
              onClick={() => {
                setShowMfaStep(false)
                setMfaResolver(null)
                setTotpCode('')
              }}
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
