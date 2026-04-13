import type { Metadata, Viewport } from 'next'
import { Open_Sans } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

const openSans = Open_Sans({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Open Line Mobility',
  description: 'Inventory management, order fulfillment, and marketplace operations',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Open Line Mobility',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#131921',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={openSans.className}>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
