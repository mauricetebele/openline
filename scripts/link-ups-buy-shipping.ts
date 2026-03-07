/**
 * Playwright script to link a UPS carrier account to Amazon Buy Shipping
 * via Seller Central's Carrier Preferences page.
 *
 * Usage:  npm run link-ups
 *
 * Prerequisites:
 *   1. Save credentials in Settings → UPS Buy Shipping
 *   2. npm install && npx playwright install chromium
 *
 * The script uses a persistent browser profile so you only need to log in
 * to Amazon Seller Central once. On subsequent runs it will reuse the session.
 */

import { chromium, type BrowserContext, type Page } from 'playwright'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import os from 'os'

// ─── Load .env manually (no dotenv dependency) ───────────────────────────────

const envPath = path.resolve(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

// ─── Inline decrypt (mirrors src/lib/crypto.ts) ──────────────────────────────

const ALGORITHM = 'aes-256-gcm'

function decrypt(stored: string): string {
  const keyHex = process.env.ENCRYPTION_KEY ?? ''
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  }
  const key = Buffer.from(keyHex, 'hex')
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':')
  if (!ivHex || !authTagHex || !ciphertextHex) throw new Error('Invalid encrypted token format')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient()

  try {
    // 1. Read credentials from DB
    const cred = await prisma.upsBuyShippingCredential.findFirst({ where: { isActive: true } })
    if (!cred) {
      console.error('No UPS Buy Shipping credentials found. Save them in Settings → UPS Buy Shipping first.')
      process.exit(1)
    }

    const accountNumber = decrypt(cred.accountNumberEnc)
    const accountZip    = decrypt(cred.accountZipEnc)
    const shipFromCity  = decrypt(cred.shipFromCityEnc)
    const country       = decrypt(cred.countryEnc)
    const upsUsername   = decrypt(cred.upsUsernameEnc)
    const upsPassword   = decrypt(cred.upsPasswordEnc)

    console.log(`✓ Loaded credentials (account: ${accountNumber.slice(0, 3)}…${accountNumber.slice(-3)})`)

    // 2. Launch Playwright Chromium with a dedicated persistent profile
    const userDataDir = path.join(os.homedir(), '.openline', 'browser-profile')
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true })
    }

    console.log('Launching browser…')
    let context: BrowserContext
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: ['--disable-blink-features=AutomationControlled'],
      })
    } catch (err) {
      console.error('Failed to launch browser:', (err as Error).message)
      process.exit(1)
    }
    console.log('✓ Browser launched')

    const page: Page = await context.newPage()

    // 3. Navigate to Carrier Preferences
    const CARRIER_PREFS_URL = 'https://sellercentral.amazon.com/carrier-preferences/main'
    console.log(`Navigating to ${CARRIER_PREFS_URL}`)
    try {
      await page.goto(CARRIER_PREFS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    } catch (err) {
      console.error('Navigation failed:', (err as Error).message)
      await context.close()
      process.exit(1)
    }

    // 4. Detect if login is needed
    if (page.url().includes('signin') || page.url().includes('ap/signin')) {
      console.log('\n⚠  Amazon login required. Please log in manually in the browser window.')
      console.log('   The script will continue automatically once you reach the Carrier Preferences page.\n')
      await page.waitForURL('**/carrier-preferences/**', { timeout: 300000 })
      console.log('✓ Login detected, continuing…')
    }

    await page.waitForTimeout(2000)

    // 5. Click "Link account"
    const linkBtn = page.getByRole('button', { name: /link account/i })
    await linkBtn.waitFor({ state: 'visible', timeout: 15000 })
    await linkBtn.click()
    console.log('✓ Clicked "Link account"')
    await page.waitForTimeout(1500)

    // 6. Select UPS tile (second "Connect" link in the modal)
    const connectLinks = page.getByText('Connect', { exact: true })
    await connectLinks.nth(1).click()
    console.log('✓ Selected UPS')
    await page.waitForTimeout(2000)

    // 7. Fill UPS account form
    //    DOM order is column-first (left col then right col):
    //    [1] Account Number  [2] Account Zip  [3] City  [4] Zip Code  [5] Country
    //    Input [0] is Amazon's search bar.
    const formInputs = page.locator('input[type="text"]:visible')
    await formInputs.nth(1).fill(accountNumber)
    await formInputs.nth(2).fill(accountZip)
    await formInputs.nth(3).fill(shipFromCity)
    await formInputs.nth(4).fill(accountZip)
    await formInputs.nth(5).fill(country)
    console.log('✓ Filled account details')

    // Click Next (span#orcas-mons-next is behind an input[type="submit"])
    const nextBtn = page.locator('#orcas-mons-next')
    await nextBtn.waitFor({ state: 'visible', timeout: 5000 })
    await nextBtn.click({ force: true })
    console.log('✓ Clicked Next')
    await page.waitForTimeout(5000)

    // 8. UPS login — two-step: username + checkbox + Continue → password + Continue

    // Dismiss cookie banner if present
    const closeCookie = page.locator('button:has-text("×"), button.close, [aria-label="close"]').first()
    if (await closeCookie.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeCookie.click()
      await page.waitForTimeout(500)
    }

    // Step 1: Username
    const userField = page.locator('input[type="text"], input[type="email"]').first()
    await userField.waitFor({ state: 'visible', timeout: 10000 })
    await userField.fill(upsUsername)

    const checkbox = page.locator('input[type="checkbox"]').first()
    if (await checkbox.isVisible().catch(() => false)) {
      if (!(await checkbox.isChecked())) await checkbox.check()
    }

    const continueBtn = page.getByRole('button', { name: /continue/i })
    await continueBtn.waitFor({ state: 'visible', timeout: 5000 })
    await continueBtn.click()
    console.log('✓ Entered username')
    await page.waitForTimeout(3000)

    // Step 2: Password
    const passField = page.locator('input[type="password"]').first()
    await passField.waitFor({ state: 'visible', timeout: 10000 })
    await passField.fill(upsPassword)

    const loginBtn = page.getByRole('button', { name: /log in|sign in|continue|submit/i }).first()
    await loginBtn.waitFor({ state: 'visible', timeout: 5000 })
    await loginBtn.click()
    console.log('✓ Entered password')

    // 9. Wait for redirect back to Amazon
    console.log('Waiting for redirect back to Amazon…')
    await page.waitForURL('**/sellercentral.amazon.com/**', { timeout: 60000 })
    console.log('✓ Redirected back to Amazon Seller Central')

    // 10. Update lastLinkedAt
    await prisma.upsBuyShippingCredential.update({
      where: { id: cred.id },
      data: { lastLinkedAt: new Date() },
    })

    console.log('\n🎉 UPS carrier account linked to Amazon Buy Shipping successfully!\n')

    await page.waitForTimeout(3000)
    await context.close()
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
