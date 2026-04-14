'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { addDays, format } from 'date-fns'

const TERMS_LABEL: Record<string, string> = {
  NET_15: 'Net 15', NET_30: 'Net 30', NET_60: 'Net 60',
  NET_90: 'Net 90', DUE_ON_RECEIPT: 'Due on Receipt',
}
const TERMS_DAYS: Record<string, number> = {
  NET_15: 15, NET_30: 30, NET_60: 60, NET_90: 90, DUE_ON_RECEIPT: 0,
}

interface CustomerResult {
  id: string
  companyName: string
  contactName?: string
  paymentTerms: string
  defaultDiscount: number
  taxRate: number
  creditLimit?: number
  addresses: { id: string; type: string; label: string; addressLine1: string; city: string; state: string; postalCode: string; isDefault: boolean }[]
  openBalance: number
}

interface ProductResult {
  id: string
  sku: string
  description: string
  inventoryItems: { qty: number; gradeId: string | null; grade: { grade: string } | null }[]
}

interface GradeOption {
  id: string
  grade: string
}

interface LineItem {
  _key: string
  productId?: string
  gradeId?: string
  sku: string
  title: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
  taxable: boolean
}

function calcLine(item: LineItem) {
  return item.quantity * item.unitPrice * (1 - item.discount / 100)
}

function calcTotals(items: LineItem[], discountPct: number, taxRate: number, shippingCost: number) {
  const subtotal    = items.reduce((s, i) => s + calcLine(i), 0)
  const discountAmt = subtotal * (discountPct / 100)
  const afterDisc   = subtotal - discountAmt
  const taxableAmt  = items.filter((i) => i.taxable).reduce((s, i) => s + calcLine(i), 0) * (1 - discountPct / 100)
  const taxAmt      = taxableAmt * (taxRate / 100)
  const total       = afterDisc + taxAmt + shippingCost
  return { subtotal, discountAmt, taxAmt, total }
}

let lineKeyCounter = 0
const blankLine = (): LineItem => ({
  _key: `line-${++lineKeyCounter}`,
  sku: '', title: '', description: '', quantity: 1, unitPrice: 0, discount: 0, taxable: true,
})

export default function WholesaleOrderCreateManager({ editOrderId }: { editOrderId?: string } = {}) {
  const router = useRouter()
  const isEdit = !!editOrderId
  const [step, setStep] = useState(isEdit ? 2 : 1)
  const [editLoading, setEditLoading] = useState(isEdit)

  // Step 1
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerResult[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null)
  const [orderDate, setOrderDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [paymentTerms, setPaymentTerms] = useState('NET_30')
  const [dueDate, setDueDate] = useState('')
  const [shippingAddressId, setShippingAddressId] = useState('')
  const [billingAddressId, setBillingAddressId] = useState('')
  const [customerPoNumber, setCustomerPoNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  // Step 2
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<ProductResult[]>([])
  const [items, setItems] = useState<LineItem[]>([blankLine()])
  const [discountPct, setDiscountPct] = useState(0)
  const [taxRate, setTaxRate] = useState(0)
  const [shippingCost, setShippingCost] = useState(0)

  // Grades
  const [grades, setGrades] = useState<GradeOption[]>([])

  // Misc
  const [saving, setSaving] = useState(false)
  const [creditWarning, setCreditWarning] = useState<string | null>(null)

  // Fetch grades on mount
  useEffect(() => {
    fetch('/api/grades').then(r => r.json()).then(d => setGrades(d.data ?? d)).catch(() => {})
  }, [])

  // Load existing order for edit mode
  useEffect(() => {
    if (!editOrderId) return
    ;(async () => {
      try {
        const res = await fetch(`/api/wholesale/orders/${editOrderId}`)
        if (!res.ok) { toast.error('Failed to load order'); router.back(); return }
        const data = await res.json()

        // Build customer object from included data
        const cust: CustomerResult = {
          id: data.customer.id,
          companyName: data.customer.companyName,
          contactName: data.customer.contactName,
          paymentTerms: data.customer.paymentTerms,
          defaultDiscount: Number(data.discountPct),
          taxRate: Number(data.taxRate),
          creditLimit: data.customer.creditLimit,
          addresses: data.customer.addresses ?? [],
          openBalance: data.customer.openBalance ?? 0,
        }
        setSelectedCustomer(cust)

        // Set order-level fields
        setOrderDate(data.orderDate ? data.orderDate.slice(0, 10) : format(new Date(), 'yyyy-MM-dd'))
        setPaymentTerms(data.paymentTerms ?? data.customer.paymentTerms ?? 'NET_30')
        setCustomerPoNumber(data.customerPoNumber ?? '')
        setNotes(data.notes ?? '')
        setInternalNotes(data.internalNotes ?? '')
        setDiscountPct(Number(data.discountPct ?? 0))
        setTaxRate(Number(data.taxRate ?? 0))
        setShippingCost(Number(data.shippingCost ?? 0))

        // Match stored address snapshots to customer address IDs
        if (data.shippingAddress && cust.addresses.length) {
          const match = cust.addresses.find(a =>
            a.type === 'SHIPPING' && a.addressLine1 === data.shippingAddress.addressLine1
          )
          if (match) setShippingAddressId(match.id)
        }
        if (data.billingAddress && cust.addresses.length) {
          const match = cust.addresses.find(a =>
            a.type === 'BILLING' && a.addressLine1 === data.billingAddress.addressLine1
          )
          if (match) setBillingAddressId(match.id)
        }

        // Populate line items
        if (data.items?.length) {
          const invMap: Record<string, ProductResult['inventoryItems']> = {}
          const loadedItems: LineItem[] = data.items.map((it: {
            productId?: string; gradeId?: string; sku?: string; title: string;
            description?: string; quantity: number; unitPrice: number; discount: number; taxable: boolean
            product?: { id: string; sku: string; description: string; inventoryItems?: ProductResult['inventoryItems'] }
            grade?: { grade: string }
          }) => {
            if (it.productId && it.product?.inventoryItems) {
              invMap[it.productId] = it.product.inventoryItems
            }
            const avail = it.product?.inventoryItems?.reduce((s, i) => s + i.qty, 0) ?? 0
            return {
              _key: `line-${++lineKeyCounter}`,
              productId: it.productId ?? undefined,
              gradeId: it.gradeId ?? undefined,
              sku: it.sku || it.product?.sku || '',
              title: it.title || it.product?.description || '',
              description: it.productId ? `Available: ${avail}` : (it.description ?? ''),
              quantity: Number(it.quantity),
              unitPrice: Number(it.unitPrice),
              discount: Number(it.discount),
              taxable: it.taxable,
            }
          })
          setItems(loadedItems)
          setProductInventoryMap(invMap)
        }
      } catch {
        toast.error('Failed to load order')
        router.back()
      } finally {
        setEditLoading(false)
      }
    })()
  }, [editOrderId, router])

  // Customer search
  const searchCustomers = useCallback(async (q: string) => {
    if (!q.trim()) { setCustomerResults([]); return }
    const res = await fetch(`/api/wholesale/customers?search=${encodeURIComponent(q)}`)
    const data = await res.json()
    setCustomerResults(data.data ?? [])
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchCustomers(customerSearch), 250)
    return () => clearTimeout(t)
  }, [customerSearch, searchCustomers])

  // Product search
  const searchProducts = useCallback(async (q: string) => {
    if (!q.trim()) { setProductResults([]); return }
    const res = await fetch(`/api/products?search=${encodeURIComponent(q)}`)
    const data = await res.json()
    setProductResults((data.data ?? data) as ProductResult[])
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchProducts(productSearch), 250)
    return () => clearTimeout(t)
  }, [productSearch, searchProducts])

  function selectCustomer(c: CustomerResult) {
    setSelectedCustomer(c)
    setPaymentTerms(c.paymentTerms)
    setDiscountPct(Number(c.defaultDiscount))
    setTaxRate(Number(c.taxRate))
    const shipping = c.addresses.find((a) => a.type === 'SHIPPING' && a.isDefault) ?? c.addresses.find((a) => a.type === 'SHIPPING')
    const billing  = c.addresses.find((a) => a.type === 'BILLING'  && a.isDefault) ?? c.addresses.find((a) => a.type === 'BILLING')
    if (shipping) setShippingAddressId(shipping.id)
    if (billing)  setBillingAddressId(billing.id)
    setCustomerSearch('')
    setCustomerResults([])
  }

  useEffect(() => {
    if (!orderDate) return
    const days = TERMS_DAYS[paymentTerms] ?? 30
    setDueDate(format(addDays(new Date(orderDate), days), 'yyyy-MM-dd'))
  }, [orderDate, paymentTerms])

  // Credit limit warning
  useEffect(() => {
    if (!selectedCustomer?.creditLimit) { setCreditWarning(null); return }
    const { total } = calcTotals(items, discountPct, taxRate, shippingCost)
    const open = selectedCustomer.openBalance ?? 0
    if (open + total > Number(selectedCustomer.creditLimit)) {
      setCreditWarning(
        `Total ($${(open + total).toFixed(2)}) exceeds credit limit of $${Number(selectedCustomer.creditLimit).toFixed(2)}`
      )
    } else {
      setCreditWarning(null)
    }
  }, [items, discountPct, taxRate, shippingCost, selectedCustomer])

  // Store product inventory info keyed by productId for grade availability
  const [productInventoryMap, setProductInventoryMap] = useState<Record<string, ProductResult['inventoryItems']>>({})

  function addProduct(p: ProductResult) {
    const avail = p.inventoryItems?.reduce((s, i) => s + i.qty, 0) ?? 0
    setProductInventoryMap(prev => ({ ...prev, [p.id]: p.inventoryItems }))
    setItems((prev) => [...prev, {
      _key: `line-${++lineKeyCounter}`,
      productId: p.id, gradeId: '', sku: p.sku, title: p.description, description: `Available: ${avail}`,
      quantity: 1, unitPrice: 0, discount: discountPct, taxable: true,
    }])
    setProductSearch('')
    setProductResults([])
  }

  function getGradeAvailability(productId: string) {
    const inv = productInventoryMap[productId] ?? []
    const byGrade: Record<string, number> = {}
    for (const item of inv) {
      const gid = item.gradeId ?? ''
      byGrade[gid] = (byGrade[gid] ?? 0) + item.qty
    }
    return byGrade
  }

  function updateLine(i: number, key: keyof LineItem, val: unknown) {
    setItems((prev) => prev.map((item, idx) => idx === i ? { ...item, [key]: val } : item))
  }

  function removeLine(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function submit() {
    if (!selectedCustomer) { toast.error('Select a customer'); return }
    if (items.length === 0 || items.every((i) => !i.title.trim())) {
      toast.error('Add at least one item'); return
    }
    setSaving(true)
    try {
      const payload = {
        customerId: selectedCustomer.id,
        orderDate,
        paymentTerms,
        shippingAddressId: shippingAddressId || undefined,
        billingAddressId:  billingAddressId  || undefined,
        customerPoNumber: customerPoNumber || undefined,
        notes, internalNotes,
        discountPct, taxRate, shippingCost,
        items: items.filter((i) => i.title.trim()).map((i) => ({
          productId: i.productId || undefined,
          gradeId: i.gradeId || undefined,
          sku: i.sku, title: i.title, description: i.description,
          quantity: i.quantity, unitPrice: i.unitPrice,
          discount: i.discount, taxable: i.taxable,
        })),
      }

      const url = isEdit ? `/api/wholesale/orders/${editOrderId}` : '/api/wholesale/orders'
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        toast.error(e.error ?? 'Failed to save order')
        return
      }

      const order = await res.json()
      toast.success(isEdit ? 'Order updated' : 'Order created — pending approval')
      router.push(`/wholesale/orders/${order.id}`)
    } catch {
      toast.error('Failed to save order')
    } finally {
      setSaving(false)
    }
  }

  const { subtotal, discountAmt, taxAmt, total } = calcTotals(items, discountPct, taxRate, shippingCost)
  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  const shippingAddresses = selectedCustomer?.addresses.filter((a) => a.type === 'SHIPPING') ?? []
  const billingAddresses  = selectedCustomer?.addresses.filter((a) => a.type === 'BILLING')  ?? []

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {editLoading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">Loading order…</div>
      ) : <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Wholesale Order' : 'New Wholesale Order'}</h1>
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-4 mb-8">
        {['Customer & Dates', 'Line Items', 'Review & Totals'].map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
              step === i + 1 ? 'bg-orange-500 border-orange-500 text-white' :
              step > i + 1  ? 'bg-green-500 border-green-500 text-white' :
              'border-gray-300 text-gray-400'
            }`}>{i + 1}</div>
            <span className={`text-sm ${step === i + 1 ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{label}</span>
            {i < 2 && <div className="w-12 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-5 bg-white rounded-xl border border-gray-200 p-6">
          {/* Customer search */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Customer *</label>
            {selectedCustomer ? (
              <div className="flex items-center gap-3 p-3 border border-green-200 bg-green-50 rounded-lg">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{selectedCustomer.companyName}</p>
                  {selectedCustomer.contactName && <p className="text-xs text-gray-500">{selectedCustomer.contactName}</p>}
                </div>
                {!isEdit && (
                  <button
                    onClick={() => setSelectedCustomer(null)}
                    className="text-xs text-red-500 hover:text-red-600"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="relative">
                <input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Search customer…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
                {customerResults.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {customerResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => selectCustomer(c)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm"
                      >
                        <span className="font-medium">{c.companyName}</span>
                        {c.contactName && <span className="text-gray-500 ml-2 text-xs">{c.contactName}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Order Date</label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms</label>
              <select
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {Object.entries(TERMS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Due Date (computed)</label>
              <input
                type="date"
                value={dueDate}
                readOnly
                className="w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500"
              />
            </div>
          </div>

          {selectedCustomer && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Shipping Address</label>
                <select
                  value={shippingAddressId}
                  onChange={(e) => setShippingAddressId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  <option value="">None</option>
                  {shippingAddresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}: {a.addressLine1}, {a.city}, {a.state}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Billing Address</label>
                <select
                  value={billingAddressId}
                  onChange={(e) => setBillingAddressId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  <option value="">None</option>
                  {billingAddresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}: {a.addressLine1}, {a.city}, {a.state}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Customer PO #</label>
            <input
              type="text"
              value={customerPoNumber}
              onChange={(e) => setCustomerPoNumber(e.target.value)}
              placeholder="Optional"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea
              rows={2} value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Internal Notes</label>
            <textarea
              rows={2} value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => { if (!selectedCustomer) { toast.error('Select a customer'); return } setStep(2) }}
              className="px-6 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600"
            >
              Next: Line Items →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {/* Credit limit warning */}
          {creditWarning && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm px-4 py-3 rounded-lg">
              ⚠️ {creditWarning}
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            {/* Product search */}
            <div className="relative">
              <label className="block text-xs font-medium text-gray-600 mb-1">Add Product</label>
              <input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search SKU or description…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              {productResults.length > 0 && (
                <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  {productResults.map((p) => {
                    const avail = p.inventoryItems?.reduce((s, i) => s + i.qty, 0) ?? 0
                    return (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm"
                      >
                        <span className="font-mono text-orange-600 mr-2">{p.sku}</span>
                        <span className="text-gray-700">{p.description}</span>
                        <span className="text-gray-400 ml-2 text-xs">({avail} in stock)</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Line items table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs font-medium text-gray-500 uppercase">
                    <th className="text-left pb-2">SKU</th>
                    <th className="text-left pb-2">Title</th>
                    <th className="text-left pb-2 w-36">Grade</th>
                    <th className="text-right pb-2 w-20">Qty</th>
                    <th className="text-right pb-2 w-28">Unit Price</th>
                    <th className="text-right pb-2 w-20">Disc%</th>
                    <th className="text-right pb-2 w-28">Line Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item, i) => (
                    <tr key={item._key}>
                      <td className="py-2 pr-2">
                        {item.productId ? (
                          <span className="text-xs font-mono text-orange-600 px-2 py-1">{item.sku}</span>
                        ) : (
                          <input
                            value={item.sku}
                            onChange={(e) => updateLine(i, 'sku', e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-orange-400"
                            placeholder="SKU"
                          />
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        {item.productId ? (
                          <span className="text-xs text-gray-700 px-2 py-1">{item.title}</span>
                        ) : (
                          <input
                            value={item.title}
                            onChange={(e) => updateLine(i, 'title', e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                            placeholder="Title"
                          />
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        {item.productId ? (
                          <select
                            value={item.gradeId ?? ''}
                            onChange={(e) => updateLine(i, 'gradeId', e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                          >
                            <option value="">Any grade</option>
                            {(() => {
                              const avail = getGradeAvailability(item.productId)
                              return grades.map(g => (
                                <option key={g.id} value={g.id}>
                                  {g.grade} ({avail[g.id] ?? 0} avail)
                                </option>
                              ))
                            })()}
                          </select>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="number" min="0" step="1"
                          value={item.quantity}
                          onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-orange-400"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="number" min="0" step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => updateLine(i, 'unitPrice', Number(e.target.value))}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-orange-400"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="number" min="0" max="100" step="0.01"
                          value={item.discount}
                          onChange={(e) => updateLine(i, 'discount', Number(e.target.value))}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-orange-400"
                        />
                      </td>
                      <td className="py-2 pr-2 text-right font-medium">{fmt(calcLine(item))}</td>
                      <td className="py-2">
                        <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-400">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={() => setItems((prev) => [...prev, blankLine()])}
              className="flex items-center gap-2 text-sm text-orange-600 hover:text-orange-700 font-medium"
            >
              <Plus size={14} /> Add Custom Line
            </button>

            <div className="text-right text-sm font-semibold text-gray-700 pt-2 border-t border-gray-100">
              Subtotal: {fmt(subtotal)}
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">← Back</button>
            <button
              onClick={() => { if (items.every((i) => !i.title.trim())) { toast.error('Add at least one item'); return } setStep(3) }}
              className="px-6 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600"
            >
              Next: Review →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="grid grid-cols-2 gap-6 text-sm">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Customer</p>
                <p className="font-semibold">{selectedCustomer?.companyName}</p>
                <p className="text-gray-500">{TERMS_LABEL[paymentTerms]}</p>
                <p className="text-gray-500">Order: {orderDate}</p>
                <p className="text-gray-500">Due: {dueDate}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Line Items</p>
                <p className="text-gray-700">{items.filter((i) => i.title.trim()).length} item(s)</p>
              </div>
            </div>

            {/* Items readonly */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-t border-gray-100">
                <thead>
                  <tr className="text-xs font-medium text-gray-500 uppercase">
                    <th className="text-left py-2">Title</th>
                    <th className="text-right py-2">Qty</th>
                    <th className="text-right py-2">Unit Price</th>
                    <th className="text-right py-2">Disc%</th>
                    <th className="text-right py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.filter((i) => i.title.trim()).map((item) => (
                    <tr key={item._key}>
                      <td className="py-1.5">{item.title}</td>
                      <td className="py-1.5 text-right">{item.quantity}</td>
                      <td className="py-1.5 text-right">{fmt(item.unitPrice)}</td>
                      <td className="py-1.5 text-right">{item.discount}%</td>
                      <td className="py-1.5 text-right">{fmt(calcLine(item))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="border-t border-gray-100 pt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span>{fmt(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Order Discount</span>
                  <input
                    type="number" min="0" max="100" step="0.01"
                    value={discountPct}
                    onChange={(e) => setDiscountPct(Number(e.target.value))}
                    className="w-16 border border-gray-200 rounded px-2 py-0.5 text-xs text-right"
                  />
                  <span className="text-gray-500 text-xs">%</span>
                </div>
                <span className="text-red-500">-{fmt(discountAmt)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Tax Rate</span>
                  <input
                    type="number" min="0" step="0.0001"
                    value={taxRate}
                    onChange={(e) => setTaxRate(Number(e.target.value))}
                    className="w-16 border border-gray-200 rounded px-2 py-0.5 text-xs text-right"
                  />
                  <span className="text-gray-500 text-xs">%</span>
                </div>
                <span>{fmt(taxAmt)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Shipping</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={shippingCost}
                    onChange={(e) => setShippingCost(Number(e.target.value))}
                    className="w-20 border border-gray-200 rounded px-2 py-0.5 text-xs text-right"
                  />
                </div>
                <span>{fmt(shippingCost)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t border-gray-200 pt-2">
                <span>TOTAL</span>
                <span>{fmt(total)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">← Back</button>
            <button
              onClick={() => submit()}
              disabled={saving}
              className="px-6 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Order'}
            </button>
          </div>
        </div>
      )}
      </>}
    </div>
  )
}
