export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import LostInboundReimbursements from '@/components/LostInboundReimbursements'

export const metadata = { title: 'Lost Inbound Reimbursements' }

export default function LostInboundReimbursementsPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-7rem)] p-6">
        <div className="mb-3">
          <h1 className="text-xl font-semibold dark:text-gray-100">Lost Inbound Reimbursements</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Amazon&apos;s reimbursement report has no shipment id — only a case id whose title names the shipment. Attribute each Lost Inbound reimbursement to its inbound shipment; the shipment view then shows it as an exact match instead of a best-guess.
          </p>
        </div>
        <LostInboundReimbursements />
      </div>
    </AppShell>
  )
}
