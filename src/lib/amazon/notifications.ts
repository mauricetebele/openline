/**
 * SP-API Notifications v1 helpers.
 *
 * Amazon SP-API Notifications delivers events (including buyer messages) to
 * an Amazon SQS queue. These helpers wrap the three operations needed:
 *   1. Create a destination (register an SQS ARN)
 *   2. Subscribe to a notification type
 *   3. List / delete subscriptions
 *
 * Docs: https://developer-docs.amazon.com/sp-api/docs/notifications-api-v1-reference
 */
import { SpApiClient } from './sp-api'

// ─── SP-API shapes ────────────────────────────────────────────────────────────

export interface NotificationDestination {
  destinationId: string
  name: string
  resource: {
    sqsResource?: { arn: string }
    eventBridgeResource?: { name: string; region: string }
  }
}

export interface NotificationSubscription {
  subscriptionId:   string
  payloadVersion:   string
  destinationId:    string
  notificationType: string
}

interface CreateDestinationResponse { payload?: NotificationDestination; errors?: { code: string; message: string }[] }
interface CreateSubscriptionResponse { payload?: NotificationSubscription; errors?: { code: string; message: string }[] }
interface GetSubscriptionResponse    { payload?: NotificationSubscription; errors?: { code: string; message: string }[] }
interface GetDestinationsResponse    { payload?: NotificationDestination[]; errors?: { code: string; message: string }[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Register an SQS queue as a notification destination.  Returns the destinationId. */
export async function createSqsDestination(
  client: SpApiClient,
  sqsArn: string,
  name = 'buyer-seller-messaging',
): Promise<string> {
  const resp = await client.post<CreateDestinationResponse>(
    '/notifications/v1/destinations',
    {
      name,
      resourceSpecification: { sqs: { arn: sqsArn } },
    },
  )
  if (resp.errors?.length) {
    throw new Error(resp.errors.map(e => `${e.code}: ${e.message}`).join('; '))
  }
  if (!resp.payload?.destinationId) throw new Error('No destinationId in SP-API response')
  return resp.payload.destinationId
}

/** Subscribe to a notification type using an existing destinationId. */
export async function subscribeToNotification(
  client: SpApiClient,
  notificationType: string,
  destinationId: string,
): Promise<string> {
  const resp = await client.post<CreateSubscriptionResponse>(
    `/notifications/v1/subscriptions/${notificationType}`,
    { destinationId },
  )
  if (resp.errors?.length) {
    throw new Error(resp.errors.map(e => `${e.code}: ${e.message}`).join('; '))
  }
  if (!resp.payload?.subscriptionId) throw new Error('No subscriptionId in SP-API response')
  return resp.payload.subscriptionId
}

/** Get the active subscription for a notification type, if any. */
export async function getSubscription(
  client: SpApiClient,
  notificationType: string,
): Promise<NotificationSubscription | null> {
  try {
    const resp = await client.get<GetSubscriptionResponse>(
      `/notifications/v1/subscriptions/${notificationType}`,
    )
    return resp.payload ?? null
  } catch {
    return null
  }
}

/** List all registered destinations. */
export async function getDestinations(
  client: SpApiClient,
): Promise<NotificationDestination[]> {
  const resp = await client.get<GetDestinationsResponse>('/notifications/v1/destinations')
  return resp.payload ?? []
}

/** Delete a subscription. */
export async function deleteSubscription(
  client: SpApiClient,
  notificationType: string,
  subscriptionId: string,
): Promise<void> {
  await client.delete(`/notifications/v1/subscriptions/${notificationType}/${subscriptionId}`)
}
