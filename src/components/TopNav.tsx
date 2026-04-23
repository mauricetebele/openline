'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ClipboardList, LogOut, ChevronDown,
  Truck, Tag, Tags, Package, Boxes, Building2, RotateCcw, ShoppingCart,
  LayoutGrid, RefreshCcw, PackageMinus, Barcode, List, ListTodo,
  Store, Users, FileText, BarChart2, Cpu, Printer, Smartphone,
  Plus, PlusCircle, Search, ArrowRightLeft, Menu, X, Settings, History,
  Moon, Sun, FolderOpen, Undo2, Upload, BookOpen, TrendingUp, Bell, Archive,
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { clsx } from 'clsx'
import { useAuth } from '@/context/AuthContext'
import OrderSearchDropdown from './OrderSearchDropdown'
import SerialQuickLookup from './SerialQuickLookup'
import InventoryQuickSearch from './InventoryQuickSearch'

type NavLeaf  = { href: string; label: string; icon: React.ElementType }
type NavGroup = { group: true; label: string; icon: React.ElementType; children: NavLeaf[] }
type NavDivider = { divider: true; label: string }
type NavItem  = NavLeaf | NavGroup | NavDivider

const NAV: NavItem[] = [
  // ── Row 1: Core daily operations ──────────────────────────────────────────
  {
    group: true,
    label: 'Fulfillment',
    icon: Package,
    children: [
      { href: '/unshipped-orders',    label: 'Order Fulfillment', icon: Package },
      { href: '/fba-shipments',       label: 'FBA Shipments',     icon: Truck },
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
      { href: '/inventory/migrate',   label: 'Migration Tool',      icon: Upload },
      { href: '/legacy-po',           label: 'Legacy PO Data',      icon: Archive },
      { href: '/legacy-invoices',     label: 'Legacy Invoices',     icon: FileText },
    ],
  },
  {
    group: true,
    label: 'Products',
    icon: Boxes,
    children: [
      { href: '/products',        label: 'Products',            icon: Boxes },
      { href: '/po-line-items',   label: 'Backfill Cost Codes', icon: ListTodo },
    ],
  },
  { href: '/marketplace-skus', label: 'Marketplace SKUs', icon: Tags },
  {
    group: true,
    label: 'Returns',
    icon: Undo2,
    children: [
      { href: '/marketplace-returns',       label: 'Marketplace Returns', icon: Undo2 },
      { href: '/wholesale/customer-rma',    label: 'Wholesale RMA',       icon: RotateCcw },
      { href: '/vendor-rma',               label: 'Vendor Returns',      icon: PackageMinus },
      { href: '/free-replacements',        label: 'Free Replacements',   icon: RefreshCcw },
    ],
  },
  {
    group: true,
    label: 'Vendors',
    icon: Building2,
    children: [
      { href: '/vendors',         label: 'Vendors',         icon: Building2 },
      { href: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart },
      { href: '/vendor-ledger',   label: 'Vendor Ledger',   icon: BookOpen },
    ],
  },
  // ── Row 2: Analytics, support & tools ─────────────────────────────────────
  {
    group: true,
    label: 'Reports',
    icon: BarChart2,
    children: [
      { href: '/profitability',      label: 'Profitability', icon: TrendingUp },
      { href: '/sales-stats',        label: 'Sales Stats',   icon: BarChart2 },
      { href: '/return-rates',       label: 'Return Rates',  icon: RotateCcw },
      { href: '/fba-sales-report',   label: 'FBA Sales',     icon: BarChart2 },
      { href: '/shipping-manifest', label: 'Manifest',      icon: ClipboardList },
    ],
  },
  { href: '/cases',            label: 'Cases',       icon: FolderOpen },
  {
    group: true,
    label: 'Customers',
    icon: Users,
    children: [
      { href: '/customers',                label: 'View Customers', icon: Users },
      { href: '/wholesale/customers?new=1', label: 'Add a Customer', icon: Plus },
    ],
  },
  { href: '/todo-list',        label: 'To Do',       icon: ListTodo },
  { href: '/serial-search',    label: 'Serial Search',    icon: Barcode },
  {
    group: true,
    label: 'Special Tools',
    icon: Cpu,
    children: [
      { href: '/refunds',            label: 'Refunds',            icon: RefreshCcw },
      { href: '/fba-refunds',       label: 'FBA Refunds',        icon: RefreshCcw },
      { href: '/returns',            label: 'MFN Returns',        icon: RotateCcw },
      { href: '/shipping-templates', label: 'Shipping Templates', icon: Truck },
      { href: '/return-label',       label: 'Return Label',       icon: Printer },
      { href: '/outbound-label',     label: 'Outbound Label',     icon: Printer },
      { href: '/create-listing',      label: 'Create Listing',     icon: PlusCircle },
      { href: '/bulk-listing',       label: 'Bulk Listing',       icon: List },
      { href: '/active-listings',    label: 'Active Listings',    icon: List },
      { href: '/pricing-rules',      label: 'Pricing Rules',      icon: Tag },
      { href: '/sickw',             label: 'SICKW',              icon: Smartphone },
      { href: '/audit',              label: 'Audit Log',          icon: ClipboardList },
    ],
  },
  {
    group: true,
    label: 'Wholesale',
    icon: Store,
    children: [
      { href: '/wholesale/customers', label: 'Customers',     icon: Users },
      { href: '/wholesale/aging',     label: 'Aging Summary',  icon: BarChart2 },
      { href: '/wholesale/orders',    label: 'Orders',         icon: FileText },
    ],
  },
]

// ─── Dropdown group item ───────────────────────────────────────────────────────

function GroupItem({ item, isActive, onNavigate, badge }: {
  item: NavGroup
  isActive: (href: string) => boolean
  onNavigate: () => void
  badge?: { count: number; color: string }
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
          badge && badge.count > 0
            ? 'bg-red-600 text-white'
            : groupActive || open
              ? 'bg-amazon-blue text-white'
              : 'text-gray-300 hover:bg-white/10 hover:text-white',
        )}
      >
        <item.icon size={14} />
        {item.label}
        {badge && badge.count > 0 && (
          <span className="text-xs font-bold">({badge.count})</span>
        )}
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
                onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { setOpen(false); onNavigate() } }}
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
  const [dueToday, setDueToday] = useState(0)
  const [unreadAlerts, setUnreadAlerts] = useState(0)

  // Fetch store logo — validate it actually loads before using
  useEffect(() => {
    fetch('/api/store-settings')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.logoBase64 && typeof d.logoBase64 === 'string' && d.logoBase64.startsWith('data:image')) {
          const img = new Image()
          img.onload = () => setStoreLogo(d.logoBase64)
          img.src = d.logoBase64
        }
      })
      .catch(() => {})
  }, [])

  // Fetch due-today count for Fulfillment badge
  useEffect(() => {
    function fetchDueToday() {
      fetch('/api/orders/due-today')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.count !== undefined) setDueToday(d.count) })
        .catch(() => {})
    }
    fetchDueToday()
    const interval = setInterval(fetchDueToday, 60_000)
    return () => clearInterval(interval)
  }, [])

  // Fetch unread alerts count for bell badge
  useEffect(() => {
    function fetchUnread() {
      fetch('/api/alerts/unread-count')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.count !== undefined) setUnreadAlerts(d.count) })
        .catch(() => {})
    }
    fetchUnread()
    const interval = setInterval(fetchUnread, 60_000)
    return () => clearInterval(interval)
  }, [])

  function isActive(href: string) {
    const path = href.split('?')[0]  // strip query string for active check
    return pathname.startsWith(path)
  }

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Separate items before and after the Wholesale divider
  const dividerIdx = NAV.findIndex(i => 'divider' in i)
  const mainItems      = dividerIdx === -1 ? NAV : NAV.slice(0, dividerIdx)
  const divider        = dividerIdx === -1 ? null  : NAV[dividerIdx] as NavDivider
  const wholesaleItems = dividerIdx === -1 ? []    : NAV.slice(dividerIdx + 1) as NavLeaf[]

  // Split mainItems into two rows for desktop nav
  const ROW1_COUNT = 6 // Products, Marketplace SKUs, Vendors, Returns, Inventory, Fulfillment
  const row1Items = mainItems.slice(0, ROW1_COUNT)
  const row2Items = mainItems.slice(ROW1_COUNT)

  function renderFlatLink(item: NavLeaf) {
    const active = isActive(item.href)
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={(e) => { if (!e.metaKey && !e.ctrlKey) setMobileOpen(false) }}
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
    <header className="sticky top-0 z-30 bg-gradient-to-b from-amazon-dark to-[#1a1f2e] text-white shadow-lg">
      {/* Row 1: Logo, search boxes, controls */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-white/[0.06]">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-2 shrink-0 group">
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
        </Link>

        <div className="hidden lg:block w-px h-6 bg-white/10 shrink-0" />

        <div className="flex-1" />

        {/* Search bar group — desktop */}
        <div className="hidden lg:flex items-center gap-2 shrink-0">
          <InventoryQuickSearch />
          <SerialQuickLookup />
          <OrderSearchDropdown />
        </div>

        <div className="hidden lg:block w-px h-6 bg-white/10 shrink-0 ml-1" />

        {/* Dark mode toggle — desktop */}
        <DarkModeToggle />

        {/* Settings gear — desktop */}
        <Link href="/settings" title="Settings"
          className={clsx(
            'hidden lg:flex items-center justify-center w-8 h-8 rounded-md transition-colors shrink-0',
            isActive('/settings') ? 'bg-amazon-blue text-white' : 'text-gray-400 hover:bg-white/10 hover:text-white',
          )}>
          <Settings size={16} />
        </Link>

        {/* Alerts bell — desktop */}
        <Link href="/alerts" title="Alerts"
          className={clsx(
            'hidden lg:flex items-center justify-center w-8 h-8 rounded-md transition-colors shrink-0 relative',
            isActive('/alerts') ? 'bg-amazon-blue text-white' : 'text-gray-400 hover:bg-white/10 hover:text-white',
          )}>
          <Bell size={16} />
          {unreadAlerts > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
              {unreadAlerts > 99 ? '99+' : unreadAlerts}
            </span>
          )}
        </Link>

        {/* User — desktop */}
        <div className="hidden lg:flex items-center gap-3 shrink-0 ml-1">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amazon-orange to-orange-600 flex items-center justify-center text-xs font-bold text-white uppercase shrink-0 shadow-sm">
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

      {/* Row 2: Desktop navigation links — top row */}
      <nav className="hidden lg:flex items-center gap-0.5 px-4 h-10 overflow-x-auto scrollbar-hide border-b border-white/[0.06]">
        {row1Items.map((item) => {
          if ('divider' in item) return null
          if ('group' in item) {
            return (
              <GroupItem
                key={item.label}
                item={item}
                isActive={isActive}
                onNavigate={() => {}}
                badge={item.label === 'Fulfillment' && dueToday > 0 ? { count: dueToday, color: 'red' } : undefined}
              />
            )
          }
          return renderFlatLink(item)
        })}
      </nav>

      {/* Row 3: Desktop navigation links — bottom row */}
      <nav className="hidden lg:flex items-center gap-0.5 px-4 h-10 overflow-x-auto scrollbar-hide">
        {row2Items.map((item) => {
          if ('divider' in item) return null
          if ('group' in item) {
            return (
              <GroupItem
                key={item.label}
                item={item}
                isActive={isActive}
                onNavigate={() => {}}
                badge={item.label === 'Fulfillment' && dueToday > 0 ? { count: dueToday, color: 'red' } : undefined}
              />
            )
          }
          return renderFlatLink(item)
        })}

        {divider && (
          <>
            <div className="w-px h-5 bg-white/10 mx-1.5 shrink-0" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mr-1 shrink-0">{divider.label}</span>
            {wholesaleItems.map(item => renderFlatLink(item))}
          </>
        )}
      </nav>

      {/* Mobile dropdown menu */}
      {mobileOpen && (
        <nav className="lg:hidden bg-gray-900 border-t border-white/10 px-3 py-3 space-y-1 max-h-[80vh] overflow-y-auto">
          {/* Mobile inventory search, serial lookup & order search */}
          <div className="pb-2 mb-1 border-b border-white/10 space-y-2">
            <InventoryQuickSearch mobile />
            <SerialQuickLookup mobile />
            <OrderSearchDropdown mobile />
          </div>
          {mainItems.map((item) => {
            if ('divider' in item) return null
            if ('group' in item) {
              return (
                <div key={item.label}>
                  <p className={clsx(
                    'text-[10px] font-semibold uppercase tracking-widest px-3 pt-2 pb-1',
                    item.label === 'Fulfillment' && dueToday > 0 ? 'text-red-400' : 'text-gray-500',
                  )}>
                    {item.label}
                    {item.label === 'Fulfillment' && dueToday > 0 && ` (${dueToday})`}
                  </p>
                  {item.children.map(child => {
                    const active = isActive(child.href)
                    return (
                      <Link key={child.href} href={child.href} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) setMobileOpen(false) }}
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
              <Link key={item.href} href={item.href} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) setMobileOpen(false) }}
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
                  <Link key={item.href} href={item.href} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) setMobileOpen(false) }}
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
            <Link href="/settings" onClick={(e) => { if (!e.metaKey && !e.ctrlKey) setMobileOpen(false) }}
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
