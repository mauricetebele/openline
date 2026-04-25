import { resend } from '@/lib/resend'

const FROM = 'Open Line Mobility <maurice@openline.us>'

interface CaseInfo {
  id: string
  caseNumber: number
  title: string
}

interface Recipient {
  email: string
  name: string
}

export function sendCaseCreatedNotification(
  caseInfo: CaseInfo,
  creatorName: string,
  description: string | null,
  recipients: Recipient[],
) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://openlinemobility.vercel.app'
  const caseUrl = `${baseUrl}/cases?id=${caseInfo.id}`

  for (const r of recipients) {
    resend.emails.send({
      from: FROM,
      to: r.email,
      subject: `[Case #${caseInfo.caseNumber}] You've been tagged by ${creatorName}`,
      html: `
        <p>Hi ${r.name},</p>
        <p><strong>${creatorName}</strong> tagged you on a new case:</p>
        <p style="font-size:16px;font-weight:600;">Case #${caseInfo.caseNumber}: ${caseInfo.title}</p>
        ${description ? `<p style="color:#555;">${description.replace(/\n/g, '<br/>')}</p>` : ''}
        <p><a href="${caseUrl}">View Case</a></p>
        <p>— Open Line Mobility</p>
      `,
    }).catch(err => console.error(`[case-emails] Failed to send created notification to ${r.email}:`, err))
  }
}

export function sendCaseAttentionNotification(
  caseInfo: CaseInfo,
  messageBody: string,
  authorName: string,
  recipients: Recipient[],
) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://openlinemobility.vercel.app'
  const caseUrl = `${baseUrl}/cases?id=${caseInfo.id}`
  // Strip mention markup for the email body
  const cleanBody = messageBody.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')

  for (const r of recipients) {
    resend.emails.send({
      from: FROM,
      to: r.email,
      subject: `[Case #${caseInfo.caseNumber}] Your Attention is Needed`,
      html: `
        <p>Hi ${r.name},</p>
        <p><strong>${authorName}</strong> requested your attention on <strong>Case #${caseInfo.caseNumber}: ${caseInfo.title}</strong>:</p>
        <blockquote style="border-left:3px solid #dc2626;padding:8px 12px;margin:12px 0;color:#555;">${cleanBody.replace(/\n/g, '<br/>')}</blockquote>
        <p><a href="${caseUrl}">View Case</a></p>
        <p>— Open Line Mobility</p>
      `,
    }).catch(err => console.error(`[case-emails] Failed to send attention notification to ${r.email}:`, err))
  }
}

export function sendCaseMessageNotification(
  caseInfo: CaseInfo,
  messageBody: string,
  authorName: string,
  recipients: Recipient[],
) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://openlinemobility.vercel.app'
  const caseUrl = `${baseUrl}/cases?id=${caseInfo.id}`

  for (const r of recipients) {
    resend.emails.send({
      from: FROM,
      to: r.email,
      subject: `[Case #${caseInfo.caseNumber}] New message from ${authorName}`,
      html: `
        <p>Hi ${r.name},</p>
        <p><strong>${authorName}</strong> posted a message on <strong>Case #${caseInfo.caseNumber}: ${caseInfo.title}</strong>:</p>
        <blockquote style="border-left:3px solid #ccc;padding:8px 12px;margin:12px 0;color:#555;">${messageBody.replace(/\n/g, '<br/>')}</blockquote>
        <p><a href="${caseUrl}">View Case</a></p>
        <p>— Open Line Mobility</p>
      `,
    }).catch(err => console.error(`[case-emails] Failed to send message notification to ${r.email}:`, err))
  }
}

export function sendCaseResolvedNotification(
  caseInfo: CaseInfo,
  resolverName: string,
  resolutionNote: string,
  recipients: Recipient[],
) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://openlinemobility.vercel.app'
  const caseUrl = `${baseUrl}/cases?id=${caseInfo.id}`

  for (const r of recipients) {
    resend.emails.send({
      from: FROM,
      to: r.email,
      subject: `[Case #${caseInfo.caseNumber}] Resolved by ${resolverName}`,
      html: `
        <p>Hi ${r.name},</p>
        <p><strong>Case #${caseInfo.caseNumber}: ${caseInfo.title}</strong> has been resolved by <strong>${resolverName}</strong>.</p>
        <p><strong>Resolution Note:</strong></p>
        <blockquote style="border-left:3px solid #22c55e;padding:8px 12px;margin:12px 0;color:#555;">${resolutionNote.replace(/\n/g, '<br/>')}</blockquote>
        <p><a href="${caseUrl}">View Case</a></p>
        <p>— Open Line Mobility</p>
      `,
    }).catch(err => console.error(`[case-emails] Failed to send resolved notification to ${r.email}:`, err))
  }
}
