'use client'
import { useState, useEffect } from 'react'
import AppShell from '@/components/AppShell'
import { useAuth } from '@/context/AuthContext'

function OlmLogoWatermark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 200" fill="none"
      className="w-[320px] max-w-[60vw] h-auto opacity-[0.08] dark:opacity-[0.10] pointer-events-none select-none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wm-lg" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#1B5EA6"/>
          <stop offset="100%" stopColor="#C1342C"/>
        </linearGradient>
      </defs>
      <path d="M60 105 C100 120, 160 40, 210 55" stroke="url(#wm-lg)" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
      <circle cx="58" cy="104" r="10" stroke="#1B5EA6" strokeWidth="3.5" fill="none"/>
      <circle cx="58" cy="104" r="3" fill="#1B5EA6"/>
      <circle cx="212" cy="54" r="11" stroke="#C1342C" strokeWidth="3.5" fill="none"/>
      <circle cx="212" cy="54" r="3.5" fill="#C1342C"/>
      <text x="140" y="148" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="32" fill="#1B3A5C" letterSpacing="3">OPEN LINE</text>
      <text x="140" y="175" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="22" fill="#C1342C" letterSpacing="6">MOBILITY</text>
    </svg>
  )
}

function HomeContent() {
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const firstName = user?.name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? ''

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] overflow-hidden px-6">
      {/* Greeting — above logo */}
      <div className={`text-center mb-8 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <p className="text-sm font-medium text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          {greeting}
        </p>
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold text-gray-900 dark:text-white tracking-tight">
          Hello, <span className="text-amazon-orange">{firstName}</span>
        </h1>
        <p className="mt-4 text-lg text-gray-400 dark:text-gray-500 max-w-md mx-auto">
          Welcome to Open Line Mobility
        </p>
      </div>

      {/* Logo — below greeting, translucent */}
      <div className={`transition-all duration-1000 delay-300 ${mounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
        <OlmLogoWatermark />
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <AppShell>
      <HomeContent />
    </AppShell>
  )
}
