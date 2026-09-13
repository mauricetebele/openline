import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Removal Photos',
  appleWebApp: { capable: true, title: 'Removal Photos', statusBarStyle: 'black-translucent' },
}

// Phone-first shell for the warehouse removal-photo uploader. Intentionally does
// NOT use the desktop AppShell/nav — it's a focused, full-screen mobile surface.
export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-gray-50 text-gray-900">
      {children}
    </div>
  )
}
