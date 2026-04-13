'use client'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import TopNav from './TopNav'

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user?.role === 'CLIENT') {
      router.replace('/client/inventory')
    }
  }, [user, loading, router])

  if (!loading && user?.role === 'CLIENT') return null

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppShellInner>{children}</AppShellInner>
      </AuthProvider>
    </ThemeProvider>
  )
}
