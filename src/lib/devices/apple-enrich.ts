/**
 * Server-side enrichment for Apple device diagnostic scans.
 *
 * The Windows agent returns only RAW values read from the device (via
 * libimobiledevice). All interpretation — marketing name, region, battery
 * health % — happens here so it can be improved via normal deploys without
 * redistributing the agent. Raw payloads are persisted alongside so old scans
 * can be reprocessed if these maps/formulas change.
 */

/** Raw payload shape sent by the agent. All values may be strings or numbers
 *  (they come from parsed plists), so coerce defensively. */
export interface RawAppleScan {
  udid?: string
  agentVersion?: string
  /** ideviceinfo root domain (SerialNumber, ProductType, ModelNumber, IMEI, …) */
  lockdown?: Record<string, unknown>
  /** ideviceinfo -q com.apple.mobile.battery (BatteryCurrentCapacity, …) */
  battery?: Record<string, unknown>
  /** idevicediagnostics ioregentry AppleSmartBattery (DesignCapacity, CycleCount, …) */
  ioregBattery?: Record<string, unknown>
}

export interface EnrichedAppleScan {
  udid: string | null
  deviceClass: string | null
  serialNumber: string | null
  imei: string | null
  imei2: string | null
  meid: string | null
  productType: string | null
  marketingName: string | null
  modelNumber: string | null
  regionCode: string | null
  regionName: string | null
  iosVersion: string | null
  batteryHealthPct: number | null
  batteryCycleCount: number | null
  batteryDesignCapacity: number | null
  batteryFullCapacity: number | null
  batteryCurrentCharge: number | null
  activationState: string | null
  agentVersion: string | null
}

// ── ProductType → marketing name ────────────────────────────────────────────
// Covers the common resale range; unknown/newer identifiers fall back to the
// raw ProductType so the scan never shows blank.
const PRODUCT_TYPE_NAMES: Record<string, string> = {
  // iPhone
  'iPhone8,1': 'iPhone 6s',
  'iPhone8,2': 'iPhone 6s Plus',
  'iPhone8,4': 'iPhone SE (1st gen)',
  'iPhone9,1': 'iPhone 7', 'iPhone9,3': 'iPhone 7',
  'iPhone9,2': 'iPhone 7 Plus', 'iPhone9,4': 'iPhone 7 Plus',
  'iPhone10,1': 'iPhone 8', 'iPhone10,4': 'iPhone 8',
  'iPhone10,2': 'iPhone 8 Plus', 'iPhone10,5': 'iPhone 8 Plus',
  'iPhone10,3': 'iPhone X', 'iPhone10,6': 'iPhone X',
  'iPhone11,8': 'iPhone XR',
  'iPhone11,2': 'iPhone XS',
  'iPhone11,4': 'iPhone XS Max', 'iPhone11,6': 'iPhone XS Max',
  'iPhone12,1': 'iPhone 11',
  'iPhone12,3': 'iPhone 11 Pro',
  'iPhone12,5': 'iPhone 11 Pro Max',
  'iPhone12,8': 'iPhone SE (2nd gen)',
  'iPhone13,1': 'iPhone 12 mini',
  'iPhone13,2': 'iPhone 12',
  'iPhone13,3': 'iPhone 12 Pro',
  'iPhone13,4': 'iPhone 12 Pro Max',
  'iPhone14,4': 'iPhone 13 mini',
  'iPhone14,5': 'iPhone 13',
  'iPhone14,2': 'iPhone 13 Pro',
  'iPhone14,3': 'iPhone 13 Pro Max',
  'iPhone14,6': 'iPhone SE (3rd gen)',
  'iPhone14,7': 'iPhone 14',
  'iPhone14,8': 'iPhone 14 Plus',
  'iPhone15,2': 'iPhone 14 Pro',
  'iPhone15,3': 'iPhone 14 Pro Max',
  'iPhone15,4': 'iPhone 15',
  'iPhone15,5': 'iPhone 15 Plus',
  'iPhone16,1': 'iPhone 15 Pro',
  'iPhone16,2': 'iPhone 15 Pro Max',
  'iPhone17,3': 'iPhone 16',
  'iPhone17,4': 'iPhone 16 Plus',
  'iPhone17,1': 'iPhone 16 Pro',
  'iPhone17,2': 'iPhone 16 Pro Max',
  'iPhone17,5': 'iPhone 16e',
  // iPad (recent common)
  'iPad7,11': 'iPad (7th gen)', 'iPad7,12': 'iPad (7th gen)',
  'iPad11,6': 'iPad (8th gen)', 'iPad11,7': 'iPad (8th gen)',
  'iPad12,1': 'iPad (9th gen)', 'iPad12,2': 'iPad (9th gen)',
  'iPad13,18': 'iPad (10th gen)', 'iPad13,19': 'iPad (10th gen)',
  'iPad11,1': 'iPad mini (5th gen)', 'iPad11,2': 'iPad mini (5th gen)',
  'iPad14,1': 'iPad mini (6th gen)', 'iPad14,2': 'iPad mini (6th gen)',
  'iPad11,3': 'iPad Air (3rd gen)', 'iPad11,4': 'iPad Air (3rd gen)',
  'iPad13,1': 'iPad Air (4th gen)', 'iPad13,2': 'iPad Air (4th gen)',
  'iPad13,16': 'iPad Air (5th gen)', 'iPad13,17': 'iPad Air (5th gen)',
  'iPad8,1': 'iPad Pro 11-inch (1st gen)', 'iPad8,2': 'iPad Pro 11-inch (1st gen)',
  'iPad8,3': 'iPad Pro 11-inch (1st gen)', 'iPad8,4': 'iPad Pro 11-inch (1st gen)',
  'iPad8,9': 'iPad Pro 11-inch (2nd gen)', 'iPad8,10': 'iPad Pro 11-inch (2nd gen)',
  'iPad13,4': 'iPad Pro 11-inch (3rd gen)', 'iPad13,5': 'iPad Pro 11-inch (3rd gen)',
  'iPad13,6': 'iPad Pro 11-inch (3rd gen)', 'iPad13,7': 'iPad Pro 11-inch (3rd gen)',
  'iPad14,3': 'iPad Pro 11-inch (4th gen)', 'iPad14,4': 'iPad Pro 11-inch (4th gen)',
  'iPad8,5': 'iPad Pro 12.9-inch (3rd gen)', 'iPad8,6': 'iPad Pro 12.9-inch (3rd gen)',
  'iPad8,7': 'iPad Pro 12.9-inch (3rd gen)', 'iPad8,8': 'iPad Pro 12.9-inch (3rd gen)',
  'iPad8,11': 'iPad Pro 12.9-inch (4th gen)', 'iPad8,12': 'iPad Pro 12.9-inch (4th gen)',
  'iPad13,8': 'iPad Pro 12.9-inch (5th gen)', 'iPad13,9': 'iPad Pro 12.9-inch (5th gen)',
  'iPad13,10': 'iPad Pro 12.9-inch (5th gen)', 'iPad13,11': 'iPad Pro 12.9-inch (5th gen)',
  'iPad14,5': 'iPad Pro 12.9-inch (6th gen)', 'iPad14,6': 'iPad Pro 12.9-inch (6th gen)',
}

// ── Model-number region suffix → country ────────────────────────────────────
const REGION_CODES: Record<string, string> = {
  LL: 'United States', LA: 'Latin America', LZ: 'Latin America',
  C: 'Canada', CL: 'Canada', VC: 'Canada',
  B: 'United Kingdom', BT: 'United Kingdom',
  X: 'Australia', FS: 'Australia',
  J: 'Japan', ZP: 'Hong Kong', ZA: 'Singapore',
  CH: 'China (mainland)', TA: 'Taiwan', KH: 'South Korea',
  IP: 'Italy', TU: 'Ireland', PP: 'Philippines', ID: 'Indonesia',
  IN: 'India', AE: 'UAE', SO: 'Middle East', AB: 'Middle East',
  ND: 'Netherlands', FD: 'Germany/Austria', GR: 'Greece',
  RS: 'Russia', RM: 'Russia', TH: 'Thailand', ZG: 'Nordic',
  MG: 'Hungary', PO: 'Portugal', QN: 'Nordic', KS: 'Nordic',
}

function toNum(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

function toStr(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

/** Parse the region letters out of a model number like "MLPK3LL/A" → "LL". */
function parseRegion(modelNumber: string | null): { code: string | null; name: string | null } {
  if (!modelNumber) return { code: null, name: null }
  const m = modelNumber.toUpperCase().match(/([A-Z]{1,3})\/[A-Z]$/)
  const code = m?.[1] ?? null
  return { code, name: code ? REGION_CODES[code] ?? null : null }
}

/** Battery health % from AppleSmartBattery ioreg capacities. Prefers
 *  NominalChargeCapacity/DesignCapacity (tracks iOS Settings closely); falls
 *  back to AppleRawMaxCapacity. Returns null if capacities are unavailable. */
export function computeBatteryHealth(ioreg: Record<string, unknown> | undefined): {
  healthPct: number | null
  cycleCount: number | null
  designCapacity: number | null
  fullCapacity: number | null
} {
  if (!ioreg) return { healthPct: null, cycleCount: null, designCapacity: null, fullCapacity: null }
  const design = toNum(ioreg.DesignCapacity)
  const full = toNum(ioreg.NominalChargeCapacity) ?? toNum(ioreg.AppleRawMaxCapacity) ?? toNum(ioreg.MaxCapacity)
  const cycleCount = toNum(ioreg.CycleCount)
  const healthPct = design && full && design > 0 ? round((full / design) * 100, 1) : null
  return {
    healthPct,
    cycleCount: cycleCount != null ? Math.round(cycleCount) : null,
    designCapacity: design != null ? Math.round(design) : null,
    fullCapacity: full != null ? Math.round(full) : null,
  }
}

export function enrichAppleScan(raw: RawAppleScan): EnrichedAppleScan {
  const ld = raw.lockdown ?? {}
  const bat = raw.battery ?? {}

  const productType = toStr(ld.ProductType)
  const modelNumber = toStr(ld.ModelNumber)
  const region = parseRegion(modelNumber)
  const battery = computeBatteryHealth(raw.ioregBattery)

  const deviceClass =
    toStr(ld.DeviceClass) ??
    (productType?.startsWith('iPad') ? 'iPad' : productType?.startsWith('iPhone') ? 'iPhone' : null)

  return {
    udid: toStr(raw.udid) ?? toStr(ld.UniqueDeviceID),
    deviceClass,
    serialNumber: toStr(ld.SerialNumber),
    imei: toStr(ld.InternationalMobileEquipmentIdentity),
    imei2: toStr(ld.InternationalMobileEquipmentIdentity2),
    meid: toStr(ld.MobileEquipmentIdentifier) ?? toStr(ld.MEID),
    productType,
    marketingName: productType ? PRODUCT_TYPE_NAMES[productType] ?? productType : null,
    modelNumber,
    regionCode: region.code,
    regionName: region.name,
    iosVersion: toStr(ld.ProductVersion),
    batteryHealthPct: battery.healthPct,
    batteryCycleCount: battery.cycleCount,
    batteryDesignCapacity: battery.designCapacity,
    batteryFullCapacity: battery.fullCapacity,
    batteryCurrentCharge: toNum(bat.BatteryCurrentCapacity) != null ? Math.round(toNum(bat.BatteryCurrentCapacity)!) : null,
    activationState: toStr(ld.ActivationState),
    agentVersion: toStr(raw.agentVersion),
  }
}
