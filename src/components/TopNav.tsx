'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ClipboardList, LogOut, ChevronDown,
  Truck, Tag, Tags, Package, Boxes, Building2, RotateCcw, ShoppingCart,
  LayoutGrid, RefreshCcw, PackageMinus, Barcode, List,
  Store, Users, FileText, BarChart2, Cpu, Printer,
  Plus, Search, ArrowRightLeft, Menu, X, Settings, History,
  Moon, Sun, FolderOpen, Undo2,
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { clsx } from 'clsx'
import { useAuth } from '@/context/AuthContext'
import OrderSearchDropdown from './OrderSearchDropdown'

type NavLeaf  = { href: string; label: string; icon: React.ElementType }
type NavGroup = { group: true; label: string; icon: React.ElementType; children: NavLeaf[] }
type NavDivider = { divider: true; label: string }
type NavItem  = NavLeaf | NavGroup | NavDivider

const NAV: NavItem[] = [
  { href: '/products',          label: 'Products',         icon: Boxes },
  { href: '/marketplace-skus', label: 'Marketplace SKUs', icon: Tags },
  {
    group: true,
    label: 'Vendors',
    icon: Building2,
    children: [
      { href: '/vendors',         label: 'Vendors',         icon: Building2 },
      { href: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart },
      { href: '/vendor-rma',            label: 'Vendor Returns',  icon: PackageMinus },
      { href: '/marketplace-returns',  label: 'MP Returns',      icon: Undo2 },
    ],
  },
  {
    group: true,
    label: 'Inventory',
    icon: LayoutGrid,
    children: [
      { href: '/inventory',           label: 'View Stock',     icon: LayoutGrid },
      { href: '/inventory/add',       label: 'Add Inventory',  icon: Plus },
      { href: '/inventory/sn-lookup', label: 'SN Lookup',      icon: Search },
      { href: '/inventory/move',      label: 'Move Inventory', icon: ArrowRightLeft },
      { href: '/inventory/convert',   label: 'Convert SKU',    icon: Tag },
      { href: '/inventory/events',    label: 'Transaction History', icon: History },
    ],
  },
  {
    group: true,
    label: 'Fulfillment',
    icon: Package,
    children: [
      { href: '/unshipped-orders',    label: 'Order Fulfillment', icon: Package },
      { href: '/shipping-manifest',   label: 'Manifest',          icon: ClipboardList },
    ],
  },
  { href: '/cases',            label: 'Cases',       icon: FolderOpen },
  { href: '/serial-search',    label: 'Serial Search',    icon: Barcode },
  {
    group: true,
    label: 'Amazon API Tool',
    icon: Cpu,
    children: [
      { href: '/refunds',            label: 'Refunds',            icon: RefreshCcw },
      { href: '/shipping-templates', label: 'Shipping Templates', icon: Truck },
      { href: '/returns',            label: 'MFN Returns',        icon: RotateCcw },
      { href: '/return-label',       label: 'Return Label',       icon: Printer },
      { href: '/active-listings',    label: 'Active Listings',    icon: List },
      { href: '/pricing-rules',      label: 'Pricing Rules',      icon: Tag },
      { href: '/audit',              label: 'Audit Log',          icon: ClipboardList },
    ],
  },
  {
    group: true,
    label: 'Customers',
    icon: Users,
    children: [
      { href: '/customers',             label: 'View Customers', icon: Users },
      { href: '/wholesale/customers?new=1', label: 'Add a Customer', icon: Plus },
      { href: '/wholesale/customer-rma',    label: 'Customer RMA',   icon: RotateCcw },
    ],
  },
  { divider: true, label: 'Wholesale' },
  { href: '/wholesale',         label: 'Wholesale',    icon: Store },
  { href: '/wholesale/orders',  label: 'WS Orders',    icon: FileText },
  { href: '/wholesale/aging',   label: 'Aging Report', icon: BarChart2 },
]

// ─── Dropdown group item ───────────────────────────────────────────────────────

function GroupItem({ item, isActive, onNavigate }: {
  item: NavGroup
  isActive: (href: string) => boolean
  onNavigate: () => void
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null!)
  const dropRef = useRef<HTMLDivElement>(null)
  const groupActive = item.children.some(c => isActive(c.href))

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (
        btnRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleToggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setCoords({ top: r.bottom + 4, left: r.left })
    }
    setOpen(v => !v)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
          groupActive || open
            ? 'bg-amazon-blue text-white'
            : 'text-gray-300 hover:bg-white/10 hover:text-white',
        )}
      >
        <item.icon size={14} />
        {item.label}
        <ChevronDown size={12} className={clsx('transition-transform', open && 'rotate-180')} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left }}
          className="w-52 bg-gray-900 border border-white/10 rounded-lg shadow-xl py-1 z-[9999]"
        >
          {item.children.map(child => {
            const active = isActive(child.href)
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={() => { setOpen(false); onNavigate() }}
                className={clsx(
                  'flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-amazon-blue text-white'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white',
                )}
              >
                <child.icon size={14} />
                {child.label}
              </Link>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}

// ─── Dark Mode Toggle ──────────────────────────────────────────────────────────

function DarkModeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="hidden lg:flex items-center justify-center w-8 h-8 rounded-md text-gray-400 hover:bg-white/10 hover:text-white transition-colors shrink-0"
    >
      {theme === 'dark'
        ? <Sun size={15} className="text-amber-400" />
        : <Moon size={15} />}
    </button>
  )
}

// ─── Main TopNav ───────────────────────────────────────────────────────────────

export default function TopNav() {
  const pathname = usePathname()
  const { user, signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [storeLogo, setStoreLogo] = useState<string | null>(null)

  // Fetch store logo
  useEffect(() => {
    fetch('/api/store-settings')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.logoBase64) setStoreLogo(d.logoBase64) })
      .catch(() => {})
  }, [])

  function isActive(href: string) {
    const path = href.split('?')[0]  // strip query string for active check
    if (path === '/wholesale') return pathname === '/wholesale'
    return pathname.startsWith(path)
  }

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Separate items before and after the Wholesale divider
  const dividerIdx = NAV.findIndex(i => 'divider' in i)
  const mainItems      = dividerIdx === -1 ? NAV : NAV.slice(0, dividerIdx)
  const divider        = dividerIdx === -1 ? null  : NAV[dividerIdx] as NavDivider
  const wholesaleItems = dividerIdx === -1 ? []    : NAV.slice(dividerIdx + 1) as NavLeaf[]

  function renderFlatLink(item: NavLeaf) {
    const active = isActive(item.href)
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
          active
            ? 'bg-amazon-blue text-white'
            : 'text-gray-300 hover:bg-white/10 hover:text-white',
        )}
      >
        <item.icon size={14} />
        {item.label}
      </Link>
    )
  }

  return (
    <header className="sticky top-0 z-30 bg-amazon-dark text-white shadow-md">
      {/* Main bar */}
      <div className="flex items-center gap-2 px-4 h-14">

        {/* Logo */}
        <Link href="/" className="flex items-center mr-4 shrink-0">
          {storeLogo ? (
            <img src={storeLogo} alt="Logo" className="h-8 w-auto object-contain" />
          ) : (
            <div className="flex flex-col leading-tight">
              <span className="text-amazon-orange font-bold text-sm leading-none">Open Line</span>
              <span className="font-bold text-sm leading-none">Mobility</span>
            </div>
          )}
        </Link>

        {/* Desktop nav wrapper — takes remaining space, clips overflow */}
        <div className="hidden lg:flex flex-1 min-w-0 relative items-center">
          <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar pr-6">
            {mainItems.map((item) => {
              if ('divider' in item) return null
              if ('group' in item) return (
                <GroupItem key={item.label} item={item} isActive={isActive} onNavigate={() => setMobileOpen(false)} />
              )
              return renderFlatLink(item)
            })}

            {/* Wholesale divider */}
            {divider && (
              <>
                <div className="w-px h-5 bg-white/20 mx-1 shrink-0" />
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest px-1 shrink-0">
                  {divider.label}
                </span>
                {wholesaleItems.map(item => renderFlatLink(item))}
              </>
            )}
          </nav>
          {/* Fade-out to indicate more items to the right */}
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-amazon-dark to-transparent" />
        </div>

        {/* Global order search — desktop */}
        <div className="hidden lg:block shrink-0">
          <OrderSearchDropdown />
        </div>

        {/* Dark mode toggle — desktop */}
        <DarkModeToggle />

        {/* Settings gear — desktop */}
        <Link href="/settings" title="Settings"
          className={clsx(
            'hidden lg:flex items-center justify-center w-8 h-8 rounded-md transition-colors shrink-0 ml-1',
            isActive('/settings') ? 'bg-amazon-blue text-white' : 'text-gray-400 hover:bg-white/10 hover:text-white',
          )}>
          <Settings size={16} />
        </Link>

        {/* User — desktop */}
        <div className="hidden lg:flex items-center gap-3 shrink-0 ml-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-amazon-orange flex items-center justify-center text-xs font-bold text-white uppercase shrink-0">
              {user?.email?.[0] ?? '?'}
            </div>
            <span className="text-xs text-gray-300 max-w-[140px] truncate">
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

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(v => !v)}
          className="lg:hidden text-white/80 hover:text-white p-1 ml-auto"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {mobileOpen && (
        <nav className="lg:hidden bg-gray-900 border-t border-white/10 px-3 py-3 space-y-1 max-h-[80vh] overflow-y-auto">
          {/* Mobile order search */}
          <div className="pb-2 mb-1 border-b border-white/10">
            <OrderSearchDropdown mobile />
          </div>
          {mainItems.map((item) => {
            if ('divider' in item) return null
            if ('group' in item) {
              return (
                <div key={item.label}>
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest px-3 pt-2 pb-1">{item.label}</p>
                  {item.children.map(child => {
                    const active = isActive(child.href)
                    return (
                      <Link key={child.href} href={child.href} onClick={() => setMobileOpen(false)}
                        className={clsx(
                          'flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                          active ? 'bg-amazon-blue text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white',
                        )}
                      >
                        <child.icon size={14} />{child.label}
                      </Link>
                    )
                  })}
                </div>
              )
            }
            const active = isActive(item.href)
            return (
              <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  active ? 'bg-amazon-blue text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white',
                )}
              >
                <item.icon size={14} />{item.label}
              </Link>
            )
          })}

          {divider && (
            <>
              <div className="pt-2 pb-1 px-3">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">{divider.label}</p>
              </div>
              {wholesaleItems.map(item => {
                const active = isActive(item.href)
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}
                    className={clsx(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      active ? 'bg-amazon-blue text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <item.icon size={14} />{item.label}
                  </Link>
                )
              })}
            </>
          )}

          {/* Settings link in mobile */}
          <div className="border-t border-white/10 pt-2 mt-1">
            <Link href="/settings" onClick={() => setMobileOpen(false)}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive('/settings') ? 'bg-amazon-blue text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white',
              )}
            >
              <Settings size={14} /> Settings
            </Link>
          </div>

          {/* User row */}
          <div className="border-t border-white/10 pt-3 mt-2 px-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-amazon-orange flex items-center justify-center text-xs font-bold text-white uppercase">
                {user?.email?.[0] ?? '?'}
              </div>
              <div>
                <p className="text-xs font-semibold text-white">{user?.name ?? user?.email?.split('@')[0]}</p>
                <p className="text-[10px] text-gray-400">{user?.email}</p>
              </div>
            </div>
            <button onClick={signOut} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white">
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </nav>
      )}
    </header>
  )
}
