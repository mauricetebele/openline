/**
 * SQS Poller — polls the configured SQS queue for Amazon SP-API notifications
 * and persists any buyer-seller messages to the order_messages table.
 *
 * Amazon wraps SP-API notifications in an SNS envelope before delivering them
 * to SQS, so each SQS message body looks like:
 *   { Type: "Notification", Message: "<JSON string>", ... }
 * The inner Message JSON is the actual SP-API notification payload.
 *
 * Supported notification types:
 *   BUYER_SELLER_MESSAGING_MESSAGE — delivers a single buyer or seller message
 */
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs'
import { prisma } from '@/lib/prisma'

// ─── Types for SP-API notification payload ───────────────────────────────────

interface BuyerSellerMessagingPayload {
  buyerSellerMessagingNotification?: {
    amazonOrderId?: string
    buyerSellerMessagingMessage?: {
      id?:           string
      body?:         string
      direction?:    'BUYER_TO_SELLER' | 'SELLER_TO_BUYER'
      createdDate?:  string
      subject?:      string
    }
  }
}

interface SpApiNotification {
  notificationVersion?: string
  notificationType?:    string
  payloadVersion?:      string
  eventTime?:           string
  payload?:             BuyerSellerMessagingPayload
  notificationMetaData?: {
    applicationId?:   string
    subscriptionId?:  string
    publishTime?:     string
    notificationId?:  string
  }
}

interface SnsEnvelope {
  Type?:             string
  MessageId?:        string
  TopicArn?:         string
  Message?:          string   // JSON-stringified SpApiNotification
  Timestamp?:        string
}

// ─── Poller ───────────────────────────────────────────────────────────────────

/**
 * Poll the SQS queue once for new messages.
 * Returns the number of notification messages processed.
 */
export async function pollSqsMessages(): Promise<{ processed: number; errors: string[] }> {
  const queueUrl = process.env.SQS_QUEUE_URL
  if (!queueUrl) throw new Error('SQS_QUEUE_URL is not set')

  const region     = process.env.AWS_REGION     ?? 'us-east-1'
  const accessKeyId     = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

  const client = new SQSClient({
    region,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  })

  // Poll up to 10 messages per call (SQS max)
  const receive = await client.send(new ReceiveMessageCommand({
    QueueUrl:            queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds:     1,   // short poll — keep response fast for UI
    VisibilityTimeout:   30,
  }))

  const messages = receive.Messages ?? []
  let processed = 0
  const errors: string[] = []

  for (const sqsMsg of messages) {
    try {
      // Unwrap SNS envelope → SP-API notification
      const envelope  = JSON.parse(sqsMsg.Body ?? '{}') as SnsEnvelope
      const rawNotif  = envelope.Type === 'Notification' && envelope.Message
        ? envelope.Message
        : sqsMsg.Body ?? '{}'
      const notification = JSON.parse(rawNotif) as SpApiNotification

      const saved = await processNotification(notification)
      if (saved) processed++

      // Acknowledge (delete) from queue regardless of whether it was saved
      await client.send(new DeleteMessageCommand({
        QueueUrl:      queueUrl,
        ReceiptHandle: sqsMsg.ReceiptHandle!,
      }))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[SQS] Error processing message:', msg)
      errors.push(msg)
      // Do NOT delete — leave it for retry / DLQ handling
    }
  }

  return { processed, errors }
}

// ─── Notification processing ──────────────────────────────────────────────────

async function processNotification(n: SpApiNotification): Promise<boolean> {
  if (n.notificationType !== 'BUYER_SELLER_MESSAGING_MESSAGE') return false

  const data = n.payload?.buyerSellerMessagingNotification
  if (!data?.amazonOrderId) return false

  const msg      = data.buyerSellerMessagingMessage
  const body     = msg?.body?.trim()
  if (!body) return false

  const amazonOrderId = data.amazonOrderId.trim().toUpperCase()
  const isInbound     = msg?.direction !== 'SELLER_TO_BUYER'
  const sentAt        = msg?.createdDate ? new Date(msg.createdDate) : new Date(n.eventTime ?? Date.now())

  // Deduplicate by SP-API message ID if provided
  if (msg?.id) {
    const existing = await prisma.orderMessage.findFirst({
      where: { amazonOrderId, spApiMessageId: msg.id },
    })
    if (existing) return false
  }

  await prisma.orderMessage.create({
    data: {
      amazonOrderId,
      messageType:    isInbound ? 'buyerReply' : 'sellerMessage',
      body,
      isInbound,
      sentAt,
      sentBy:         isInbound ? null : 'Amazon (auto-captured)',
      spApiMessageId: msg?.id ?? null,
    },
  })

  console.log(`[SQS] Saved ${isInbound ? 'inbound' : 'outbound'} message for order ${amazonOrderId}`)
  return true
}
