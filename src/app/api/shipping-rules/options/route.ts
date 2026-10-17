/**
 * GET /api/shipping-rules/options
 * Supplies the pickers for the Back Market shipping-rule editor:
 *   - package presets (for mapping a rule to a box)
 *   - the "then" shipping methods: ShipStation carriers+services (live),
 *     linked FedEx services, linked UPS services, and linked UPS accounts.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'
import { UPS_SERVICES } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'

const FEDEX_SERVICES = [
  { code: 'FEDEX_GROUND', name: 'FedEx Ground' },
  { code: 'GROUND_HOME_DELIVERY', name: 'FedEx Home Delivery' },
  { code: 'FEDEX_EXPRESS_SAVER', name: 'FedEx Express Saver' },
  { code: 'FEDEX_2_DAY', name: 'FedEx 2Day' },
  { code: 'FEDEX_2_DAY_AM', name: 'FedEx 2Day A.M.' },
  { code: 'STANDARD_OVERNIGHT', name: 'FedEx Standard Overnight' },
  { code: 'PRIORITY_OVERNIGHT', name: 'FedEx Priority Overnight' },
  { code: 'FIRST_OVERNIGHT', name: 'FedEx First Overnight' },
]

// FedEx One Rate packaging options (One Rate is a flat rate by FedEx box/envelope).
const FEDEX_ONERATE_PACKAGING = [
  { code: 'FEDEX_ENVELOPE', name: 'FedEx Envelope' },
  { code: 'FEDEX_PAK', name: 'FedEx Pak' },
  { code: 'FEDEX_SMALL_BOX', name: 'FedEx Small Box' },
  { code: 'FEDEX_MEDIUM_BOX', name: 'FedEx Medium Box' },
  { code: 'FEDEX_LARGE_BOX', name: 'FedEx Large Box' },
  { code: 'FEDEX_EXTRA_LARGE_BOX', name: 'FedEx Extra Large Box' },
  { code: 'FEDEX_TUBE', name: 'FedEx Tube' },
]

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [presets, upsCreds] = await Promise.all([
    prisma.packagePreset.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.upsCredential.findMany({ select: { id: true, nickname: true, isDefault: true }, orderBy: { isDefault: 'desc' } }),
  ])

  // ShipStation carriers + their services (best-effort; empty if not connected).
  let shipstationCarriers: { carrierCode: string; carrierName: string; services: { code: string; name: string }[] }[] = []
  try {
    const acct = await prisma.shipStationAccount.findFirst({
      where: { isActive: true }, orderBy: { createdAt: 'asc' },
      select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
    })
    if (acct) {
      const client = new ShipStationClient(decrypt(acct.apiKeyEnc), acct.apiSecretEnc ? decrypt(acct.apiSecretEnc) : '', acct.v2ApiKeyEnc ? decrypt(acct.v2ApiKeyEnc) : null)
      const carriers = await client.getCarriers()
      shipstationCarriers = await Promise.all(
        carriers
          .filter(c => !c.code.toLowerCase().includes('amazon')) // BM orders don't use Amazon Buy Shipping
          .map(async c => {
            const services = await client.getCarrierServices(c.code).catch(() => [])
            // c.name is the real carrier ("UPS"); c.nickname is the funding card.
            return {
              carrierCode: c.code,
              carrierName: c.name + (c.accountNumber ? ` (${c.accountNumber})` : ''),
              services: services.filter(s => s.domestic).map(s => ({ code: s.code, name: s.name })),
            }
          }),
      )
    }
  } catch { /* leave empty */ }

  return NextResponse.json({
    presets,
    shipstationCarriers,
    fedexServices: FEDEX_SERVICES,
    fedexOneRatePackaging: FEDEX_ONERATE_PACKAGING,
    upsServices: UPS_SERVICES.map(s => ({ code: s.code, name: s.label })),
    upsAccounts: upsCreds,
  })
}
