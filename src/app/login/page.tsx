'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithEmail } from '@/lib/firebase-auth-rest'
import { toast } from 'sonner'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      // 1. Sign in via Firebase Auth REST API — no firebase npm package needed
      const { idToken } = await signInWithEmail(email, password)

      // 2. Exchange the ID token for a server-side session cookie
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })

      if (!res.ok) throw new Error('Failed to create session')

      router.push('/refunds')
      router.refresh()
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      const message = (err as Error)?.message ?? 'Unknown error'
      console.error('[Login error]', { code, message, err })
      if (code === 'auth/invalid-credential') {
        toast.error('Invalid email or password')
      } else if (code === 'auth/too-many-requests') {
        toast.error('Too many attempts. Try again later.')
      } else if (code === 'auth/user-disabled') {
        toast.error('This account has been disabled.')
      } else {
        toast.error(`Sign-in failed: ${message}`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-amazon-dark flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <div className="text-amazon-orange font-bold text-2xl mb-1">Refund Auditor</div>
          <p className="text-gray-500 text-sm">Amazon Seller Central</p>
        </div>

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
      </div>
    </div>
  )
}
