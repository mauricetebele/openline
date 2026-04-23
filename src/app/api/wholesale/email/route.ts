import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { resend } from '@/lib/resend'
import { generateInvoicePDF } from '@/lib/generate-wholesale-invoice'
import { generateCreditMemoPDF } from '@/lib/generate-credit-memo-pdf'
import { generatePaymentReceiptPDF } from '@/lib/generate-payment-receipt'
import { generateStatementPDF } from '@/lib/generate-statement-pdf'

const FROM = 'Open Line Mobility <maurice@openline.us>'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { type, id, viewType, to: overrideTo } = body as {
    type: 'invoice' | 'credit-memo' | 'payment' | 'statement'
    id: string
    viewType?: 'activity' | 'open'
    to?: string
  }

  if (!type || !id) {
    return NextResponse.json({ error: 'type and id are required' }, { status: 400 })
  }

  try {
    let to: string
    let subject: string
    let html: string
    let filename: string
    let pdfBuffer: Buffer

    switch (type) {
      case 'invoice': {
        const order = await prisma.salesOrder.findUnique({
          where: { id },
          include: {
            items: { include: { product: true, grade: { select: { grade: true } } } },
            customer: { include: { addresses: true } },
            serialAssignments: {
              include: { inventorySerial: { select: { id: true, serialNumber: true, productId: true } } },
            },
          },
        })
        if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

        const email = order.customer.email
        if (!email && !overrideTo) return NextResponse.json({ error: 'Customer has no email on file' }, { status: 400 })

        const billing = (order.customer.addresses ?? []).find((a: { type: string }) => a.type === 'BILLING') ?? null
        const shipping = (order.customer.addresses ?? []).find((a: { type: string }) => a.type === 'SHIPPING') ?? null

        const invRef = order.invoiceNumber ?? order.orderNumber
        const toAddr = (a: typeof billing) => a ? { addressLine1: a.addressLine1, addressLine2: a.addressLine2 ?? undefined, city: a.city, state: a.state, postalCode: a.postalCode } : null
        const buf = generateInvoicePDF({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          fulfillmentStatus: order.fulfillmentStatus,
          orderDate: order.orderDate.toISOString(),
          dueDate: order.dueDate?.toISOString(),
          customerPoNumber: order.customerPoNumber ?? undefined,
          customer: { id: order.customer.id, companyName: order.customer.companyName, paymentTerms: order.customer.paymentTerms },
          items: order.items.map(i => ({
            id: i.id,
            productId: i.productId ?? undefined,
            sku: i.sku ?? undefined,
            title: i.title,
            description: i.description ?? undefined,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
            discount: Number(i.discount),
            total: Number(i.total),
            taxable: i.taxable,
            isInvoiceAddon: i.isInvoiceAddon,
            product: i.product ? { id: i.product.id, sku: i.product.sku } : null,
            grade: i.grade,
          })),
          serialAssignments: order.serialAssignments,
          billingAddress: toAddr(billing),
          shippingAddress: toAddr(shipping),
          subtotal: Number(order.subtotal),
          discountPct: Number(order.discountPct),
          discountAmt: Number(order.discountAmt),
          taxRate: Number(order.taxRate),
          taxAmt: Number(order.taxAmt),
          shippingCost: Number(order.shippingCost),
          total: Number(order.total),
          paidAmount: Number(order.paidAmount),
          balance: Number(order.balance),
          notes: order.notes ?? undefined,
          internalNotes: order.internalNotes ?? undefined,
          invoiceNumber: order.invoiceNumber ?? undefined,
          invoicedAt: order.invoicedAt?.toISOString(),
          shipCarrier: order.shipCarrier ?? undefined,
          shipTracking: order.shipTracking ?? undefined,
          shippedAt: order.shippedAt?.toISOString(),
        }, true) as Buffer

        to = email ?? ''
        subject = `Invoice ${invRef} — Open Line Mobility`
        html = `<p>Hi,</p><p>Please find your invoice <strong>${invRef}</strong> attached.</p><p>Thank you,<br/>Open Line Mobility</p>`
        filename = `Invoice-${invRef}.pdf`
        pdfBuffer = buf
        break
      }

      case 'credit-memo': {
        const memo = await prisma.wholesaleCreditMemo.findUnique({
          where: { id },
          include: {
            customer: { include: { addresses: true } },
            rma: { select: { id: true, rmaNumber: true } },
          },
        })
        if (!memo) return NextResponse.json({ error: 'Credit memo not found' }, { status: 404 })

        const email = memo.customer.email
        if (!email && !overrideTo) return NextResponse.json({ error: 'Customer has no email on file' }, { status: 400 })

        const billing = (memo.customer.addresses ?? []).find((a: { type: string }) => a.type === 'BILLING') ?? null

        let serials: { serialNumber: string; sku: string; salePrice: number }[] = []
        let rmaNumber = memo.memo ?? 'Manual Credit'
        if (memo.rmaId) {
          const rma = await prisma.customerRMA.findUnique({
            where: { id: memo.rmaId },
            include: {
              serials: {
                where: { receivedAt: { not: null } },
                include: { product: { select: { sku: true } } },
              },
            },
          })
          if (rma) {
            rmaNumber = memo.rma?.rmaNumber ?? rma.rmaNumber
            serials = rma.serials.map(s => ({
              serialNumber: s.serialNumber,
              sku: s.product?.sku ?? '',
              salePrice: Number(s.salePrice ?? 0),
            }))
          }
        }

        const buf = await generateCreditMemoPDF({
          memoNumber: memo.memoNumber,
          createdAt: memo.createdAt.toISOString(),
          customerName: memo.customer.companyName,
          rmaNumber,
          billingAddress: billing,
          serials,
          subtotal: Number(memo.subtotal),
          restockingFee: Number(memo.restockingFee),
          total: Number(memo.total),
          notes: memo.notes,
        }, true) as Buffer

        to = email ?? ''
        subject = `Credit Memo ${memo.memoNumber} — Open Line Mobility`
        html = `<p>Hi,</p><p>Please find your credit memo <strong>${memo.memoNumber}</strong> attached.</p><p>Thank you,<br/>Open Line Mobility</p>`
        filename = `CreditMemo-${memo.memoNumber}.pdf`
        pdfBuffer = buf
        break
      }

      case 'payment': {
        const payment = await prisma.wholesalePayment.findUnique({
          where: { id },
          include: {
            customer: true,
            allocations: {
              include: { order: { select: { id: true, orderNumber: true, invoiceNumber: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        })
        if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

        const email = payment.customer.email
        if (!email && !overrideTo) return NextResponse.json({ error: 'Customer has no email on file' }, { status: 400 })

        const buf = generatePaymentReceiptPDF({
          paymentNumber: payment.paymentNumber,
          paymentDate: payment.paymentDate.toISOString(),
          amount: Number(payment.amount),
          method: payment.method,
          reference: payment.reference ?? undefined,
          memo: payment.memo ?? undefined,
          unallocated: Number(payment.unallocated),
          customer: { companyName: payment.customer.companyName },
          allocations: payment.allocations.map(a => ({
            amount: Number(a.amount),
            createdAt: a.createdAt.toISOString(),
            order: { orderNumber: a.order.orderNumber, invoiceNumber: a.order.invoiceNumber ?? undefined },
          })),
        }, true) as Buffer

        to = email ?? ''
        subject = `Payment Receipt ${payment.paymentNumber} — Open Line Mobility`
        html = `<p>Hi,</p><p>Please find your payment receipt <strong>${payment.paymentNumber}</strong> attached.</p><p>Thank you,<br/>Open Line Mobility</p>`
        filename = `Payment-${payment.paymentNumber}.pdf`
        pdfBuffer = buf
        break
      }

      case 'statement': {
        const view = viewType ?? 'activity'

        const customer = await prisma.wholesaleCustomer.findUnique({
          where: { id },
          select: { id: true, companyName: true, contactName: true, email: true },
        })
        if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
        if (!customer.email && !overrideTo) return NextResponse.json({ error: 'Customer has no email on file' }, { status: 400 })

        const [orders, payments, creditMemos] = await Promise.all([
          prisma.salesOrder.findMany({
            where: {
              customerId: id,
              status: view === 'open'
                ? { in: ['INVOICED', 'PARTIALLY_PAID'] }
                : { in: ['INVOICED', 'PARTIALLY_PAID', 'PAID'] },
            },
            orderBy: { orderDate: 'asc' },
          }),
          prisma.wholesalePayment.findMany({
            where: { customerId: id, ...(view === 'open' ? { unallocated: { gt: 0 } } : {}) },
            orderBy: { paymentDate: 'asc' },
          }),
          prisma.wholesaleCreditMemo.findMany({
            where: { customerId: id, ...(view === 'open' ? { unallocated: { gt: 0 } } : {}) },
            include: { rma: { select: { rmaNumber: true } } },
            orderBy: { createdAt: 'asc' },
          }),
        ])

        type StmtLine = {
          date: Date; type: 'INVOICE' | 'PAYMENT' | 'CREDIT_MEMO'
          reference: string; invoiceNumber: string | null
          charges: number; credits: number; applied: number; remaining: number
          balance: number; paymentId?: string
        }

        const events: Array<{ date: Date; line: Omit<StmtLine, 'balance'> }> = [
          ...orders.map(o => {
            const total = Number(o.total), bal = Number(o.balance)
            return { date: o.orderDate, line: { date: o.orderDate, type: 'INVOICE' as const, reference: o.orderNumber, invoiceNumber: o.invoiceNumber ?? null, charges: total, credits: 0, applied: total - bal, remaining: bal } }
          }),
          ...payments.map(p => {
            const amt = Number(p.amount), unalloc = Number(p.unallocated)
            return { date: p.paymentDate, line: { date: p.paymentDate, type: 'PAYMENT' as const, reference: p.reference || '', invoiceNumber: p.paymentNumber || null, charges: 0, credits: amt, applied: amt - unalloc, remaining: unalloc, paymentId: p.id } }
          }),
          ...creditMemos.map(cm => {
            const total = Number(cm.total), unalloc = Number(cm.unallocated)
            return { date: cm.createdAt, line: { date: cm.createdAt, type: 'CREDIT_MEMO' as const, reference: cm.rma?.rmaNumber ?? cm.memo ?? '', invoiceNumber: cm.memoNumber, charges: 0, credits: total, applied: total - unalloc, remaining: unalloc } }
          }),
        ].sort((a, b) => a.date.getTime() - b.date.getTime())

        let runningBalance = 0
        const lines: StmtLine[] = []
        for (const event of events) {
          if (event.line.type === 'INVOICE') runningBalance += event.line.charges
          else runningBalance -= event.line.credits
          lines.push({ ...event.line, balance: runningBalance })
        }

        let openBalance: number
        if (view === 'open') {
          openBalance = lines.reduce((sum, l) => l.type === 'INVOICE' ? sum + l.remaining : sum - l.remaining, 0)
        } else {
          openBalance = lines.length > 0 ? lines[lines.length - 1].balance : 0
        }

        const stmtLines = lines.reverse().map(l => ({
          ...l,
          date: l.date.toISOString(),
        }))

        const buf = generateStatementPDF(
          { id: customer.id, companyName: customer.companyName, contactName: customer.contactName ?? undefined },
          stmtLines,
          openBalance,
          view,
          true,
        ) as Buffer

        const prefix = view === 'open' ? 'Open Statement' : 'Statement'
        to = customer.email ?? ''
        subject = `${prefix} — ${customer.companyName} — Open Line Mobility`
        html = `<p>Hi,</p><p>Please find the ${prefix.toLowerCase()} for <strong>${customer.companyName}</strong> attached.</p><p>Thank you,<br/>Open Line Mobility</p>`
        filename = `${prefix.replace(' ', '-')}-${customer.companyName.replace(/\s+/g, '-')}.pdf`
        pdfBuffer = buf
        break
      }

      default:
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    if (overrideTo) to = overrideTo

    await resend.emails.send({
      from: FROM,
      to,
      subject,
      html,
      attachments: [{ filename, content: pdfBuffer }],
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Email send error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send email' },
      { status: 500 },
    )
  }
}
