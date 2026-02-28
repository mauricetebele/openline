/**
 * Seeds your real Amazon account into the DB with an encrypted refresh token.
 * Run: npm run db:seed-account
 */
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import * as dotenv from 'dotenv'
dotenv.config()

const prisma = new PrismaClient()

function encrypt(plaintext: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

async function main() {
  const sellerId       = process.env.AMAZON_SELLER_ID!
  const marketplaceId  = process.env.AMAZON_MARKETPLACE_ID ?? 'ATVPDKIKX0DER'
  const refreshToken   = process.env.AMAZON_REFRESH_TOKEN!

  if (!sellerId || !refreshToken) {
    throw new Error('AMAZON_SELLER_ID and AMAZON_REFRESH_TOKEN must be set in .env')
  }

  const account = await prisma.amazonAccount.upsert({
    where: { sellerId_marketplaceId: { sellerId, marketplaceId } },
    update: {
      refreshTokenEnc: encrypt(refreshToken),
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      isActive: true,
    },
    create: {
      sellerId,
      marketplaceId,
      marketplaceName: 'Amazon.com',
      region: 'NA',
      accessTokenEnc:  encrypt('PENDING'),
      refreshTokenEnc: encrypt(refreshToken),
      tokenExpiresAt:  new Date(Date.now() + 3_600_000),
    },
  })

  console.log(`✅ Amazon account seeded: ${account.sellerId} (id: ${account.id})`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
