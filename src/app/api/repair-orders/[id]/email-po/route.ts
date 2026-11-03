/**
 * POST /api/repair-orders/[id]/email-po   { to?: string }
 * Emails the Repair PO spreadsheet. Defaults to the repair vendor's email;
 * `to` overrides the recipient.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { resend } from '@/lib/resend'
import { buildRepairPoXlsx } from '@/lib/repair-po-xlsx'

export const dynamic = 'force-dynamic'

const FROM = 'Open Line Mobility <maurice@openline.us>'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const override = typeof body?.to === 'string' ? body.to.trim() : ''

  const file = await buildRepairPoXlsx(params.id)
  if (!file) return NextResponse.json({ error: 'Repair order not found' }, { status: 404 })

  const to = override || file.vendorEmail || ''
  if (!to) {
    return NextResponse.json({ error: 'No recipient — the vendor has no email on file. Enter an address to send to.' }, { status: 400 })
  }
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: `"${to}" is not a valid email address` }, { status: 400 })
  }

  const { error: sendError } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Repair PO ${file.ro} — Open Line Mobility`,
    html: `<p>Hi,</p><p>Please find Repair Purchase Order <strong>${file.ro}</strong> attached.</p><p>Thank you,<br/>Open Line Mobility</p>`,
    attachments: [{ filename: file.filename, content: file.buffer }],
  })

  if (sendError) {
    console.error('[repair email-po] Resend error:', sendError)
    return NextResponse.json({ error: sendError.message ?? 'Failed to send email' }, { status: 500 })
  }

  return NextResponse.json({ success: true, to })
}
