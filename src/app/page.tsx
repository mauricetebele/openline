'use client'
import { useState, useEffect } from 'react'
import AppShell from '@/components/AppShell'
import { useAuth } from '@/context/AuthContext'

function HomeContent() {
  const { user } = useAuth()
  const [logo, setLogo] = useState('/logos/olm-logo.svg')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    fetch('/api/store-settings')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.logoBase64) setLogo(d.logoBase64) })
      .catch(() => {})
  }, [])

  const firstName = user?.name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? ''

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="relative flex items-center justify-center min-h-[calc(100vh-8rem)] overflow-hidden">
      {/* Translucent logo watermark */}
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 m-auto w-[480px] max-w-[75vw] h-auto object-contain opacity-[0.07] dark:opacity-[0.10] dark:invert pointer-events-none select-none"
      />

      {/* Greeting content */}
      <div className={`relative z-10 text-center px-6 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
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
