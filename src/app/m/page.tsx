import Link from 'next/link'
import { Package, Camera, ChevronRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

const TOOLS = [
  { href: '/m/fulfillment', label: 'Order Fulfillment', desc: 'Process, label, serialize & ship orders', icon: Package },
  { href: '/m/removals', label: 'Removal Photos', desc: 'Upload photos to a removal case', icon: Camera },
]

export default function MobileHome() {
  return (
    <div className="min-h-[100dvh] bg-gray-50">
      <header className="bg-amazon-blue text-white px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-4">
        <h1 className="text-lg font-bold">Openline Mobile</h1>
        <p className="text-xs text-white/70 mt-0.5">Warehouse tools</p>
      </header>
      <div className="p-3 space-y-2">
        {TOOLS.map(t => (
          <Link key={t.href} href={t.href} className="flex items-center gap-3 bg-white rounded-xl p-4 shadow-sm active:bg-gray-50">
            <span className="w-10 h-10 rounded-lg bg-amazon-blue/10 text-amazon-blue flex items-center justify-center shrink-0"><t.icon size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900">{t.label}</span>
              <span className="block text-[12px] text-gray-500">{t.desc}</span>
            </span>
            <ChevronRight size={18} className="text-gray-300" />
          </Link>
        ))}
      </div>
    </div>
  )
}
