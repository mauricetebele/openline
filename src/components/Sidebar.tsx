'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, ClipboardList, Link2, LogOut, ChevronRight, ChevronDown,
  Truck, Tag, Package, Boxes, Building2, RotateCcw, ShoppingCart, Warehouse,
  LayoutGrid, X, RefreshCcw, PackageMinus, Barcode, List,
  Store, Users, FileText, BarChart2, Cpu, Ship,
  Plus, Search, ArrowRightLeft, FolderOpen,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/context/AuthContext'

type NavLeaf = { href: string; label: string; icon: React.ElementType }

type NavItem =
  | NavLeaf
  | { divider: true; label: string }
  | { group: true; label: string; icon: React.ElementType; children: NavLeaf[] }

const NAV: NavItem[] = [
  { href: '/dashboard',        label: 'Dashboard',       icon: LayoutDashboard },
  { href: '/products',         label: 'Products',        icon: Boxes },
  { href: '/vendors',          label: 'Vendors',         icon: Building2 },
  { href: '/purchase-orders',  label: 'Purchase Orders', icon: ShoppingCart },
  { href: '/warehouses',       label: 'Warehouses',      icon: Warehouse },
  {
    group: true,
    label: 'Inventory',
    icon: LayoutGrid,
    children: [
      { href: '/inventory',             label: 'View Stock',      icon: LayoutGrid },
      { href: '/inventory/add',         label: 'Add Inventory',   icon: Plus },
      { href: '/inventory/sn-lookup',   label: 'SN Lookup',       icon: Search },
      { href: '/inventory/move',        label: 'Move Inventory',  icon: ArrowRightLeft },
      { href: '/inventory/convert',     label: 'Convert SKU',     icon: Tag },
    ],
  },
  { href: '/unshipped-orders', label: 'Order Fulfillment',icon: Package },
  { href: '/cases',            label: 'Cases',           icon: FolderOpen },
  { href: '/vendor-rma',       label: 'Vendor Returns',  icon: PackageMinus },
  { href: '/serial-search',   label: 'Serial Search',   icon: Barcode },
  { href: '/connect',          label: 'Connect Amazon',  icon: Link2 },
  { href: '/shipstation',      label: 'ShipStation',     icon: Ship },
  {
    group: true,
    label: 'Amazon API Tool',
    icon: Cpu,
    children: [
      { href: '/refunds',            label: 'Refunds',           icon: RefreshCcw },
      { href: '/shipping-templates', label: 'Shipping Templates',icon: Truck },
      { href: '/returns',            label: 'MFN Returns',       icon: RotateCcw },
      { href: '/active-listings',    label: 'Active Listings',   icon: List },
      { href: '/pricing-rules',      label: 'Pricing Rules',     icon: Tag },
      { href: '/audit',              label: 'Audit Log',         icon: ClipboardList },
    ],
  },
  { divider: true, label: 'Wholesale' },
  { href: '/wholesale',           label: 'Wholesale',     icon: Store },
  { href: '/wholesale/customers', label: 'WS Customers',  icon: Users },
  { href: '/wholesale/orders',    label: 'WS Orders',     icon: FileText },
  { href: '/wholesale/aging',     label: 'Aging Report',  icon: BarChart2 },
]

const AMAZON_TOOL_HREFS    = ['/refunds', '/shipping-templates', '/returns', '/active-listings', '/pricing-rules', '/audit']
const INVENTORY_HREFS      = ['/inventory']

interface SidebarProps {
  open?: boolean
  onClose?: () => void
}

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname()
  const { user, signOut } = useAuth()

  const amazonGroupActive    = AMAZON_TOOL_HREFS.some(h => pathname.startsWith(h))
  const inventoryGroupActive = INVENTORY_HREFS.some(h => pathname.startsWith(h))
  const [amazonOpen,    setAmazonOpen]    = useState(amazonGroupActive)
  const [inventoryOpen, setInventoryOpen] = useState(inventoryGroupActive)

  // Auto-expand if navigating directly to a child route
  useEffect(() => { if (amazonGroupActive)    setAmazonOpen(true)    }, [amazonGroupActive])
  useEffect(() => { if (inventoryGroupActive) setInventoryOpen(true) }, [inventoryGroupActive])

  function isActive(href: string) {
    if (href === '/wholesale') return pathname === '/wholesale'
    return pathname.startsWith(href)
  }

  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-30 flex w-[220px] flex-col bg-amazon-dark text-white',
        'transition-transform duration-300 ease-in-out',
        open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      )}
    >
      {/* Logo row + mobile close button */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/olm-icon.svg" alt="" width={36} height={24} className="shrink-0" />
          <div className="flex flex-col leading-tight">
            <span className="text-[#5B9BD5] font-bold text-sm leading-none">Open Line</span>
            <span className="text-[#C1342C] font-bold text-[11px] leading-none tracking-wider">MOBILITY</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="lg:hidden text-white/50 hover:text-white p-1 -mr-1"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {NAV.map((item, i) => {
          // Divider
          if ('divider' in item) {
            return (
              <div key={item.label} className="pt-3 pb-1 px-3">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">{item.label}</p>
              </div>
            )
          }

          // Collapsible group
          if ('group' in item) {
            const { label, icon: Icon, children } = item
            const groupActive = children.some(c => isActive(c.href))
            const isInventory = label === 'Inventory'
            const isOpen      = isInventory ? inventoryOpen : amazonOpen
            const toggle      = isInventory ? () => setInventoryOpen(v => !v) : () => setAmazonOpen(v => !v)
            return (
              <div key={label}>
                <button
                  onClick={toggle}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    groupActive
                      ? 'bg-amazon-blue text-white'
                      : 'text-gray-300 hover:bg-white/10 hover:text-white',
                  )}
                >
                  <Icon size={16} />
                  <span className="flex-1 text-left">{label}</span>
                  {isOpen
                    ? <ChevronDown size={14} className="opacity-70" />
                    : <ChevronRight size={14} className="opacity-70" />
                  }
                </button>
                {isOpen && (
                  <div className="mt-1 ml-3 pl-3 border-l border-white/10 space-y-1">
                    {children.map(child => {
                      const active = isActive(child.href)
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onClose}
                          className={clsx(
                            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                            active
                              ? 'bg-amazon-blue text-white'
                              : 'text-gray-300 hover:bg-white/10 hover:text-white',
                          )}
                        >
                          <child.icon size={15} />
                          {child.label}
                          {active && <ChevronRight size={13} className="ml-auto opacity-70" />}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }

          // Regular link
          const { href, label, icon: Icon } = item
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-amazon-blue text-white'
                  : 'text-gray-300 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon size={16} />
              {label}
              {active && <ChevronRight size={14} className="ml-auto opacity-70" />}
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div className="border-t border-white/10 px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-7 h-7 rounded-full bg-amazon-orange flex items-center justify-center text-xs font-bold text-white uppercase">
            {user?.email?.[0] ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white truncate">
              {user?.name ?? user?.email?.split('@')[0]}
            </p>
            <p className="text-[10px] text-gray-400 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <LogOut size={12} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
