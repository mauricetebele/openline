'use client'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { LogOut } from 'lucide-react'

function ResolutionProviderHeader() {
  const { user, signOut } = useAuth()

  return (
    <header className="sticky top-0 z-30 bg-gradient-to-b from-amazon-dark to-[#1a1f2e] text-white shadow-lg">
      <div className="flex items-center gap-3 px-4 h-12">
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" fill="none" className="h-7 w-auto shrink-0">
            <defs><linearGradient id="lg" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stopColor="#1B5EA6"/><stop offset="100%" stopColor="#C1342C"/></linearGradient></defs>
            <path d="M10 28 C20 34, 38 6, 50 12" stroke="url(#lg)" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <circle cx="9" cy="27.5" r="5.5" stroke="#1B5EA6" strokeWidth="2" fill="none"/><circle cx="9" cy="27.5" r="1.8" fill="#1B5EA6"/>
            <circle cx="50.5" cy="12" r="6" stroke="#C1342C" strokeWidth="2" fill="none"/><circle cx="50.5" cy="12" r="2" fill="#C1342C"/>
          </svg>
          <div className="flex flex-col leading-tight">
            <span className="text-white font-bold text-[13px] leading-none tracking-wide">OPEN LINE</span>
            <span className="text-[#C1342C] font-bold text-[10px] leading-none tracking-[0.15em]">MOBILITY</span>
          </div>
        </div>

        <div className="w-px h-6 bg-white/10 shrink-0" />
        <span className="text-sm font-medium text-gray-300">Resolution Center</span>

        <div className="flex-1" />

        {/* User */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-xs font-bold text-white uppercase shrink-0 shadow-sm">
              {user?.email?.[0] ?? '?'}
            </div>
            <span className="text-xs text-gray-300 max-w-[140px] truncate hidden sm:block">
              {user?.name ?? user?.email?.split('@')[0]}
            </span>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}

function ResolutionProviderShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user && user.role !== 'RESOLUTION_PROVIDER') {
      router.replace('/inventory')
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    )
  }

  if (!user || user.role !== 'RESOLUTION_PROVIDER') return null

  return (
    <div className="flex flex-col min-h-screen">
      <ResolutionProviderHeader />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}

export default function ResolutionProviderShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ResolutionProviderShellInner>{children}</ResolutionProviderShellInner>
      </AuthProvider>
    </ThemeProvider>
  )
}
