/**
 * POST /api/admin/seed-demo
 * Seeds the database with realistic demo orders and buyer-seller message
 * conversations so the UI can be tested without real Amazon data.
 *
 * Idempotent — calling it again resets the demo records (deletes then re-creates).
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { OrderWorkflowStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

// ─── Demo data constants ──────────────────────────────────────────────────────

const ACCOUNT_ID = 'cmlyd4ndf0000t7f09mwp45ba' // active Amazon account

const DEMO_ORDER_IDS = [
  '114-5551001-0000011',
  '114-5551002-0000022',
  '114-5551003-0000033',
  '114-5551004-0000044',
  '114-5551005-0000055',
]

interface DemoOrder {
  amazonOrderId:        string
  olmNumber:            number
  orderStatus:          string
  workflowStatus:       OrderWorkflowStatus
  purchaseDate:         Date
  lastUpdateDate:       Date
  orderTotal:           number
  shipToName:           string
  shipToAddress1:       string
  shipToCity:           string
  shipToState:          string
  shipToPostal:         string
  isPrime:              boolean
  numberOfItemsUnshipped: number
  isBuyerRequestedCancel: boolean
  items: {
    orderItemId: string
    asin:        string
    sellerSku:   string
    title:       string
    quantityOrdered: number
    itemPrice:   number
  }[]
}

const DEMO_ORDERS: DemoOrder[] = [
  {
    amazonOrderId:           '114-5551001-0000011',
    olmNumber:               9001,
    orderStatus:             'Unshipped',
    workflowStatus:          'PENDING',
    purchaseDate:            new Date('2026-02-20T14:23:11Z'),
    lastUpdateDate:          new Date('2026-02-20T14:23:11Z'),
    orderTotal:              149.99,
    shipToName:              'James Carter',
    shipToAddress1:          '742 Evergreen Terrace',
    shipToCity:              'Springfield',
    shipToState:             'IL',
    shipToPostal:            '62701',
    isPrime:                 true,
    numberOfItemsUnshipped:  1,
    isBuyerRequestedCancel:  false,
    items: [
      { orderItemId: 'ITEM-9001-A', asin: 'B09XYZ1001', sellerSku: 'IPHONE15-64-BLK', title: 'Apple iPhone 15 64GB Black — Refurbished', quantityOrdered: 1, itemPrice: 149.99 },
    ],
  },
  {
    amazonOrderId:           '114-5551002-0000022',
    olmNumber:               9002,
    orderStatus:             'Unshipped',
    workflowStatus:          'PROCESSING',
    purchaseDate:            new Date('2026-02-21T09:10:05Z'),
    lastUpdateDate:          new Date('2026-02-21T09:10:05Z'),
    orderTotal:              89.95,
    shipToName:              'Maria Gonzalez',
    shipToAddress1:          '1600 Pennsylvania Ave',
    shipToCity:              'Washington',
    shipToState:             'DC',
    shipToPostal:            '20500',
    isPrime:                 true,
    numberOfItemsUnshipped:  1,
    isBuyerRequestedCancel:  false,
    items: [
      { orderItemId: 'ITEM-9002-A', asin: 'B09XYZ1002', sellerSku: 'SAMSUNG-A54-WHT', title: 'Samsung Galaxy A54 128GB White — Renewed', quantityOrdered: 1, itemPrice: 89.95 },
    ],
  },
  {
    amazonOrderId:           '114-5551003-0000033',
    olmNumber:               9003,
    orderStatus:             'Shipped',
    workflowStatus:          'AWAITING_VERIFICATION',
    purchaseDate:            new Date('2026-02-18T11:44:00Z'),
    lastUpdateDate:          new Date('2026-02-22T08:00:00Z'),
    orderTotal:              219.00,
    shipToName:              'David Kim',
    shipToAddress1:          '350 Fifth Avenue',
    shipToCity:              'New York',
    shipToState:             'NY',
    shipToPostal:            '10118',
    isPrime:                 false,
    numberOfItemsUnshipped:  0,
    isBuyerRequestedCancel:  false,
    items: [
      { orderItemId: 'ITEM-9003-A', asin: 'B09XYZ1003', sellerSku: 'IPAD-AIR5-64-GRY', title: 'Apple iPad Air 5th Gen 64GB Space Gray — Refurbished', quantityOrdered: 1, itemPrice: 219.00 },
    ],
  },
  {
    amazonOrderId:           '114-5551004-0000044',
    olmNumber:               9004,
    orderStatus:             'Shipped',
    workflowStatus:          'SHIPPED',
    purchaseDate:            new Date('2026-02-15T16:30:00Z'),
    lastUpdateDate:          new Date('2026-02-17T12:00:00Z'),
    orderTotal:              64.50,
    shipToName:              'Sarah Thompson',
    shipToAddress1:          '221B Baker Street',
    shipToCity:              'Chicago',
    shipToState:             'IL',
    shipToPostal:            '60601',
    isPrime:                 true,
    numberOfItemsUnshipped:  0,
    isBuyerRequestedCancel:  false,
    items: [
      { orderItemId: 'ITEM-9004-A', asin: 'B09XYZ1004', sellerSku: 'AIRPODS-PRO2-WHT', title: 'Apple AirPods Pro 2nd Generation — Certified Refurbished', quantityOrdered: 1, itemPrice: 64.50 },
    ],
  },
  {
    amazonOrderId:           '114-5551005-0000055',
    olmNumber:               9005,
    orderStatus:             'Unshipped',
    workflowStatus:          'PENDING',
    purchaseDate:            new Date('2026-02-22T07:55:30Z'),
    lastUpdateDate:          new Date('2026-02-22T07:55:30Z'),
    orderTotal:              295.00,
    shipToName:              'Robert Brown',
    shipToAddress1:          '4 Privet Drive',
    shipToCity:              'Austin',
    shipToState:             'TX',
    shipToPostal:            '73301',
    isPrime:                 false,
    numberOfItemsUnshipped:  2,
    isBuyerRequestedCancel:  false,
    items: [
      { orderItemId: 'ITEM-9005-A', asin: 'B09XYZ1005', sellerSku: 'MACBOOK-PRO13-SLV', title: 'Apple MacBook Pro 13" M1 256GB Silver — Refurbished', quantityOrdered: 1, itemPrice: 275.00 },
      { orderItemId: 'ITEM-9005-B', asin: 'B09XYZ1006', sellerSku: 'USBC-HUB-7PORT',   title: 'USB-C 7-in-1 Hub — Refurbished', quantityOrdered: 1, itemPrice: 20.00 },
    ],
  },
]

// ─── Demo conversations ───────────────────────────────────────────────────────

interface DemoMessage {
  amazonOrderId: string
  messageType:   string
  body:          string
  isInbound:     boolean
  sentAt:        Date
  sentBy:        string | null
}

const DEMO_MESSAGES: DemoMessage[] = [
  // Order 9001 — buyer asks about condition, seller answers
  {
    amazonOrderId: '114-5551001-0000011',
    messageType: 'buyerReply', body: 'Hi! I wanted to confirm — is this phone unlocked and compatible with T-Mobile? Also, is the battery health above 80%?',
    isInbound: true, sentAt: new Date('2026-02-20T15:00:00Z'), sentBy: null,
  },
  {
    amazonOrderId: '114-5551001-0000011',
    messageType: 'confirmOrderDetails', body: 'Hello James! Yes, this iPhone 15 is fully unlocked and compatible with all major US carriers including T-Mobile. Battery health is at 89%. It has been professionally refurbished and passed our 35-point inspection. Let us know if you have any other questions!',
    isInbound: false, sentAt: new Date('2026-02-20T16:30:00Z'), sentBy: 'support@store.com',
  },
  {
    amazonOrderId: '114-5551001-0000011',
    messageType: 'buyerReply', body: 'Perfect, thank you! Looking forward to receiving it.',
    isInbound: true, sentAt: new Date('2026-02-20T17:05:00Z'), sentBy: null,
  },

  // Order 9002 — buyer inquires about warranty
  {
    amazonOrderId: '114-5551002-0000022',
    messageType: 'buyerReply', body: 'Does this Samsung come with a warranty? And what accessories are included in the box?',
    isInbound: true, sentAt: new Date('2026-02-21T10:00:00Z'), sentBy: null,
  },
  {
    amazonOrderId: '114-5551002-0000022',
    messageType: 'confirmOrderDetails', body: 'Hi Maria! The Samsung Galaxy A54 comes with a 90-day seller warranty. Included in the box: USB-C cable, charging adapter, and screen protector pre-applied. Original earbuds are not included but the phone is in excellent cosmetic condition. Enjoy your purchase!',
    isInbound: false, sentAt: new Date('2026-02-21T11:15:00Z'), sentBy: 'support@store.com',
  },

  // Order 9003 — buyer reports issue post-shipping
  {
    amazonOrderId: '114-5551003-0000033',
    messageType: 'buyerReply', body: 'I received my iPad but the screen has a small crack in the bottom-right corner. It was not mentioned in the listing. Please advise.',
    isInbound: true, sentAt: new Date('2026-02-22T09:00:00Z'), sentBy: null,
  },
  {
    amazonOrderId: '114-5551003-0000033',
    messageType: 'unexpectedProblem', body: 'Hi David, I apologize sincerely for this. We take all quality control issues very seriously. Please send us a photo of the damage and I will arrange an immediate replacement or full refund — whichever you prefer. We will also cover return shipping.',
    isInbound: false, sentAt: new Date('2026-02-22T10:00:00Z'), sentBy: 'support@store.com',
  },
  {
    amazonOrderId: '114-5551003-0000033',
    messageType: 'buyerReply', body: 'Thank you for the quick response. I would prefer a replacement if one is available. Sending photos now.',
    isInbound: true, sentAt: new Date('2026-02-22T10:45:00Z'), sentBy: null,
  },
  {
    amazonOrderId: '114-5551003-0000033',
    messageType: 'unexpectedProblem', body: "Got your photos — confirmed. I've initiated a replacement order and you'll receive a prepaid return label within 24 hours via email. The replacement will ship within 1-2 business days. Again, I'm very sorry for the inconvenience.",
    isInbound: false, sentAt: new Date('2026-02-22T11:30:00Z'), sentBy: 'support@store.com',
  },

  // Order 9004 — happy buyer, feedback request
  {
    amazonOrderId: '114-5551004-0000044',
    messageType: 'buyerReply', body: 'Received my AirPods today — they work perfectly and arrived fast! Very happy with the purchase.',
    isInbound: true, sentAt: new Date('2026-02-18T14:00:00Z'), sentBy: null,
  },
  {
    amazonOrderId: '114-5551004-0000044',
    messageType: 'negativeFeedbackRemoval', body: "Hi Sarah! We're so glad you're happy with your purchase! If you have a moment, an honest review on Amazon would mean the world to us — it helps other buyers make informed decisions. Thank you for choosing us and enjoy your AirPods!",
    isInbound: false, sentAt: new Date('2026-02-18T15:00:00Z'), sentBy: 'support@store.com',
  },

  // Order 9005 — delivery question
  {
    amazonOrderId: '114-5551005-0000055',
    messageType: 'buyerReply', body: 'Hi, when can I expect delivery? The tracking page just shows "label created" and nothing has updated in 2 days.',
    isInbound: true, sentAt: new Date('2026-02-22T09:30:00Z'), sentBy: null,
  },
  {
    amazonOrderId: '114-5551005-0000055',
    messageType: 'confirmDeliveryDetails', body: "Hi Robert! We apologize for the confusion. Your order was picked up by the carrier this morning but tracking updates can lag 24-48 hours. Your expected delivery date is Feb 25th. I've noted your concern and we're monitoring the shipment. If tracking doesn't update by tomorrow, I'll escalate immediately.",
    isInbound: false, sentAt: new Date('2026-02-22T10:15:00Z'), sentBy: 'support@store.com',
  },
]

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Delete any existing demo records (idempotent reset)
  await prisma.orderMessage.deleteMany({
    where: { amazonOrderId: { in: DEMO_ORDER_IDS } },
  })
  // Delete orders (cascade deletes items)
  await prisma.order.deleteMany({
    where: { amazonOrderId: { in: DEMO_ORDER_IDS } },
  })

  // 2. Create demo orders + items
  for (const o of DEMO_ORDERS) {
    const { items, ...orderFields } = o
    const created = await prisma.order.create({
      data: {
        ...orderFields,
        accountId: ACCOUNT_ID,
        currency:  'USD',
        fulfillmentChannel: 'MFN',
        shipmentServiceLevel: 'Standard',
        lastSyncedAt: new Date(),
        items: {
          create: items.map(it => ({
            orderItemId:    it.orderItemId,
            asin:           it.asin,
            sellerSku:      it.sellerSku,
            title:          it.title,
            quantityOrdered: it.quantityOrdered,
            itemPrice:      it.itemPrice,
          })),
        },
      },
    })
    console.log(`[seed-demo] Created order ${created.amazonOrderId}`)
  }

  // 3. Create demo messages
  await prisma.orderMessage.createMany({ data: DEMO_MESSAGES })

  return NextResponse.json({
    ok: true,
    orders: DEMO_ORDERS.length,
    messages: DEMO_MESSAGES.length,
    orderIds: DEMO_ORDER_IDS,
  })
}
