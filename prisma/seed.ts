/**
 * Seed script — creates demo users in both Firebase Auth and the local DB,
 * then inserts demo Amazon account + refunds.
 *
 * Run: npm run db:seed
 *
 * Requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env
 */
import * as admin from 'firebase-admin'
import { PrismaClient, UserRole, FulfillmentType, ReviewStatus, InvalidReason } from '@prisma/client'

// Load .env manually for ts-node
import * as dotenv from 'dotenv'
dotenv.config()

// Init Firebase Admin — uses service account if available, otherwise ADC
if (!admin.apps.length) {
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    })
  } else {
    // No service account key — use Application Default Credentials
    // Run: gcloud auth application-default login
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    })
  }
}

const firebaseAuth = admin.auth()
const prisma = new PrismaClient()

interface SeedUser {
  email: string
  password: string
  name: string
  role: UserRole
}

const SEED_USERS: SeedUser[] = [
  { email: 'admin@example.com',    password: 'Admin123!',    name: 'Admin User',    role: UserRole.ADMIN },
  { email: 'reviewer@example.com', password: 'Reviewer123!', name: 'Reviewer User', role: UserRole.REVIEWER },
]

async function upsertFirebaseUser(u: SeedUser): Promise<string> {
  try {
    // Try to fetch existing user by email
    const existing = await firebaseAuth.getUserByEmail(u.email)
    return existing.uid
  } catch {
    // User doesn't exist — create them
    const created = await firebaseAuth.createUser({
      email: u.email,
      password: u.password,
      displayName: u.name,
    })
    return created.uid
  }
}

async function main() {
  console.log('🌱  Seeding database + Firebase Auth...')

  // ─── Users ────────────────────────────────────────────────────────────────
  for (const u of SEED_USERS) {
    let firebaseUid: string | null = null
    try {
      firebaseUid = await upsertFirebaseUser(u)
      console.log(`  ✓ Firebase user: ${u.email} (UID: ${firebaseUid})`)
    } catch (err) {
      console.warn(`  ⚠ Could not create Firebase user for ${u.email}: ${(err as Error).message}`)
      console.warn(`    → Create this user manually in Firebase Console → Authentication → Users`)
    }

    await prisma.user.upsert({
      where: { email: u.email },
      update: { ...(firebaseUid ? { firebaseUid } : {}), name: u.name, role: u.role },
      create: {
        email: u.email,
        ...(firebaseUid ? { firebaseUid } : {}),
        name: u.name,
        role: u.role,
      },
    })
    console.log(`  ✓ DB user: ${u.email} (role: ${u.role})`)
  }

  // ─── Demo Amazon Account ──────────────────────────────────────────────────
  const demoAccount = await prisma.amazonAccount.upsert({
    where: { sellerId_marketplaceId: { sellerId: 'DEMO_SELLER_001', marketplaceId: 'ATVPDKIKX0DER' } },
    update: {},
    create: {
      sellerId: 'DEMO_SELLER_001',
      marketplaceId: 'ATVPDKIKX0DER',
      marketplaceName: 'Amazon.com',
      region: 'NA',
      accessTokenEnc: 'DEMO_TOKEN',
      refreshTokenEnc: 'DEMO_REFRESH',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
    },
  })
  console.log(`  ✓ Demo Amazon account: ${demoAccount.sellerId}`)

  // ─── Demo Refunds ─────────────────────────────────────────────────────────
  const demoRefunds = [
    { orderId: '113-1234567-0000001', adjustmentId: 'ADJ001', postedDate: new Date('2024-11-01'), amount: 29.99,  fulfillmentType: FulfillmentType.FBA, sku: 'WIDGET-BLUE-L',  asin: 'B08XYZ1111', reasonCode: 'CUSTOMER_RETURN' },
    { orderId: '113-2345678-0000002', adjustmentId: 'ADJ002', postedDate: new Date('2024-11-03'), amount: 49.95,  fulfillmentType: FulfillmentType.MFN, sku: 'GADGET-PRO-V2',  asin: 'B08XYZ2222', reasonCode: 'ITEM_NOT_AS_DESCRIBED' },
    { orderId: '113-3456789-0000003', adjustmentId: 'ADJ003', postedDate: new Date('2024-11-05'), amount: 15.00,  fulfillmentType: FulfillmentType.FBA, sku: 'CASE-RED-M',     asin: 'B08XYZ3333', reasonCode: 'CUSTOMER_RETURN' },
    { orderId: '113-4567890-0000004', adjustmentId: 'ADJ004', postedDate: new Date('2024-11-10'), amount: 89.00,  fulfillmentType: FulfillmentType.MFN, sku: 'TOOL-SET-DLXE',  asin: 'B08XYZ4444', reasonCode: 'MISSING_PARTS' },
    { orderId: '113-5678901-0000005', adjustmentId: 'ADJ005', postedDate: new Date('2024-11-15'), amount: 199.99, fulfillmentType: FulfillmentType.FBA, sku: 'HEADPHONES-BLK', asin: 'B08XYZ5555', reasonCode: 'SWITCHEROO' },
  ]

  for (const r of demoRefunds) {
    const refund = await prisma.refund.upsert({
      where: { accountId_orderId_adjustmentId: { accountId: demoAccount.id, orderId: r.orderId, adjustmentId: r.adjustmentId } },
      update: {},
      create: {
        accountId: demoAccount.id,
        ...r,
        currency: 'USD',
        marketplaceId: 'ATVPDKIKX0DER',
        rawPayload: { demo: true, ...r },
      },
    })
    await prisma.review.upsert({
      where: { refundId: refund.id },
      update: {},
      create: { refundId: refund.id },
    })
  }

  // Mark one refund as INVALID for demo
  const flagged = await prisma.refund.findFirst({ where: { adjustmentId: 'ADJ005' } })
  const reviewer = await prisma.user.findUnique({ where: { email: 'reviewer@example.com' } })
  if (flagged && reviewer) {
    await prisma.review.update({
      where: { refundId: flagged.id },
      data: {
        status: ReviewStatus.INVALID,
        invalidReason: InvalidReason.DIFFERENT_ITEM_RETURNED,
        notes: 'Customer returned a completely different product.',
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
      },
    })
  }

  console.log(`  ✓ Demo refunds: ${demoRefunds.length} records`)
  console.log('\n✅  Seed complete.')
  console.log('   Login credentials:')
  SEED_USERS.forEach((u) => console.log(`     ${u.email}  /  ${u.password}`))
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
