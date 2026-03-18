'use client'
import { AuthProvider } from '@/context/AuthContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { StockBgProvider } from '@/context/StockBgContext'
import TopNav from './TopNav'
import ChatWidget from './ChatWidget'

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <StockBgProvider>
        <AuthProvider>
          <div className="flex flex-col min-h-screen">
            <TopNav />
            <main className="flex-1 overflow-auto">
              {children}
            </main>
            <ChatWidget />
          </div>
        </AuthProvider>
      </StockBgProvider>
    </ThemeProvider>
  )
}
