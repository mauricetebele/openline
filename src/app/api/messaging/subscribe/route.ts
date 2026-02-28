/**
 * GET  /api/messaging/subscribe
 *   Returns the current notification subscription status for the active account.
 *
 * POST /api/messaging/subscribe
 *   Body: { sqsArn: string }
 *   Registers an SQS ARN as a notification destination and subscribes to
 *   BUYER_SELLER_MESSAGING_MESSAGE notifications.
 *
 * DELETE /api/messaging/subscribe
 *   Removes the subscription and destination.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'
import {
  createSqsDestination,
  subscribeToNotification,
  getSubscription,
  deleteSubscription,
} from '@/lib/amazon/notifications'

export const dynamic = 'force-dynamic'

const NOTIFICATION_TYPE = 'BUYER_SELLER_MESSAGING_MESSAGE'

// ─── GET — subscription status ───────────────────────────────────────────────

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return NextResponse.json({ status: 'NO_ACCOUNT', subscription: null })

  const sub = await prisma.notificationSubscription.findUnique({
    where: { accountId_notificationType: { accountId: account.id, notificationType: NOTIFICATION_TYPE } },
  })

  // Optionally verify against SP-API (non-fatal)
  let apiVerified: boolean | null = null
  if (sub?.subscriptionId) {
    try {
      const client = new SpApiClient(account.id)
      const apiSub = await getSubscription(client, NOTIFICATION_TYPE)
      apiVerified = apiSub?.subscriptionId === sub.subscriptionId
    } catch {
      // ignore — DB record is source of truth
    }
  }

  return NextResponse.json({
    status:          sub?.status ?? 'INACTIVE',
    subscription:    sub ?? null,
    sqsConfigured:   !!process.env.SQS_QUEUE_URL,
    awsConfigured:   !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    apiVerified,
  })
}

// ─── POST — create subscription ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return NextResponse.json({ error: 'No active Amazon account' }, { status: 400 })

  let sqsArn: string | undefined
  try {
    const body = await req.json() as { sqsArn?: string }
    sqsArn = body.sqsArn?.trim() || process.env.SQS_QUEUE_ARN
  } catch {
    sqsArn = process.env.SQS_QUEUE_ARN
  }

  if (!sqsArn) {
    return NextResponse.json(
      { error: 'SQS ARN is required. Provide sqsArn in the request body or set SQS_QUEUE_ARN in environment.' },
      { status: 400 },
    )
  }

  const client = new SpApiClient(account.id)

  // 1. Create or reuse an SQS destination
  let destinationId: string
  try {
    destinationId = await createSqsDestination(client, sqsArn)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.notificationSubscription.upsert({
      where: { accountId_notificationType: { accountId: account.id, notificationType: NOTIFICATION_TYPE } },
      update: { status: 'FAILED', errorMessage: `Destination creation failed: ${msg}`, updatedAt: new Date() },
      create: { accountId: account.id, notificationType: NOTIFICATION_TYPE, sqsArn, status: 'FAILED', errorMessage: `Destination creation failed: ${msg}` },
    })
    return NextResponse.json({ error: `Failed to create SQS destination: ${msg}` }, { status: 502 })
  }

  // 2. Subscribe to BUYER_SELLER_MESSAGING_MESSAGE
  let subscriptionId: string
  try {
    subscriptionId = await subscribeToNotification(client, NOTIFICATION_TYPE, destinationId)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.notificationSubscription.upsert({
      where: { accountId_notificationType: { accountId: account.id, notificationType: NOTIFICATION_TYPE } },
      update: { status: 'FAILED', destinationId, sqsArn, errorMessage: `Subscription failed: ${msg}`, updatedAt: new Date() },
      create: { accountId: account.id, notificationType: NOTIFICATION_TYPE, destinationId, sqsArn, status: 'FAILED', errorMessage: `Subscription failed: ${msg}` },
    })
    return NextResponse.json({ error: `Failed to subscribe: ${msg}` }, { status: 502 })
  }

  // 3. Persist to DB
  const saved = await prisma.notificationSubscription.upsert({
    where: { accountId_notificationType: { accountId: account.id, notificationType: NOTIFICATION_TYPE } },
    update: { destinationId, subscriptionId, sqsArn, status: 'ACTIVE', errorMessage: null, updatedAt: new Date() },
    create: { accountId: account.id, notificationType: NOTIFICATION_TYPE, destinationId, subscriptionId, sqsArn, status: 'ACTIVE' },
  })

  return NextResponse.json({ ok: true, subscription: saved })
}

// ─── DELETE — remove subscription ────────────────────────────────────────────

export async function DELETE() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return NextResponse.json({ error: 'No active Amazon account' }, { status: 400 })

  const sub = await prisma.notificationSubscription.findUnique({
    where: { accountId_notificationType: { accountId: account.id, notificationType: NOTIFICATION_TYPE } },
  })

  if (sub?.subscriptionId) {
    try {
      const client = new SpApiClient(account.id)
      await deleteSubscription(client, NOTIFICATION_TYPE, sub.subscriptionId)
    } catch (err) {
      console.warn('[messaging/subscribe] SP-API delete error (continuing):', err)
    }
  }

  await prisma.notificationSubscription.deleteMany({
    where: { accountId: account.id, notificationType: NOTIFICATION_TYPE },
  })

  return NextResponse.json({ ok: true })
}
