import ClientShell from '@/components/ClientShell'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <ClientShell>{children}</ClientShell>
}
