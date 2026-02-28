/**
 * POST /api/messaging/poll
 * Manually triggers an SQS poll — fetches any queued notifications and saves
 * buyer/seller messages to the order_messages table.
 *
 * Call this from the UI "Refresh Messages" button or set up a cron job
 * (e.g. Vercel Cron) to call it periodically.
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { pollSqsMessages } from '@/lib/amazon/sqs-poller'

export const dynamic = 'force-dynamic'

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.SQS_QUEUE_URL) {
    return NextResponse.json(
      { error: 'SQS_QUEUE_URL is not configured. Set it in your .env file.' },
      { status: 400 },
    )
  }

  try {
    const result = await pollSqsMessages()
    return NextResponse.json({ ok: true, ...result })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `SQS poll failed: ${msg}` }, { status: 502 })
  }
}
