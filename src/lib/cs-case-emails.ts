import { resend } from '@/lib/resend'

const FROM = 'Open Line Mobility <maurice@openline.us>'

interface CsCaseMsgNotification {
  caseId: string
  caseNumber: number
  authorName: string
  body: string
  hasAttachments?: boolean
  recipientEmail: string
  recipientName: string
}

/**
 * Notify the customer-service agent (the case creator) at their login email
 * that a new message was posted on one of their cases. Links straight to the
 * case in the Case Manager. Best-effort — never throws into the request path.
 */
export function sendCsCaseMessageNotification(n: CsCaseMsgNotification) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://openlinemobility.vercel.app'
  const caseUrl = `${baseUrl}/customer-service?case=${n.caseId}`
  const label = `CS-${n.caseNumber}`
  const body = (n.body && n.body !== '(see attachments)') ? n.body : ''

  return resend.emails.send({
    from: FROM,
    to: n.recipientEmail,
    subject: `[${label}] New message from ${n.authorName}`,
    html: `
      <p>Hi ${n.recipientName},</p>
      <p><strong>${n.authorName}</strong> posted a new message on Customer Service case <strong>${label}</strong>:</p>
      ${body ? `<blockquote style="border-left:3px solid #6366f1;padding:8px 12px;margin:12px 0;color:#555;">${body.replace(/\n/g, '<br/>')}</blockquote>` : ''}
      ${n.hasAttachments ? `<p style="color:#555;">📎 This message includes attachment(s).</p>` : ''}
      <p><a href="${caseUrl}">View case ${label}</a></p>
      <p>— Open Line Mobility</p>
    `,
  }).catch(err => console.error(`[cs-case-emails] Failed to notify ${n.recipientEmail} for ${label}:`, err))
}
