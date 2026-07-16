/**
 * SICKW Find My iPhone / iCloud-lock service selection + result parsing.
 *
 * SICKW retired the "Apple Basic Info" service (id 30). FMI status now comes
 * from device-type-specific services:
 *   • iPhone / iPad / Apple Watch → "iCloud ON/OFF"                       (service 3)
 *   • iMac / MacBook (MBPRO/MBAIR) → "Macbook & iMac iCloud ON/OFF Status" (service 110)
 *
 * Result string differs per service:
 *   • service 3   → "... Find My iPhone: ON/OFF"
 *   • service 110 → "... iCloud Lock: ON/OFF"
 * parseFmiStatus() handles both (plus the legacy Basic Info format).
 *
 * Pure functions with no server-only deps — safe to import in client components.
 */

export interface FmiService {
  serviceId: number
  serviceName: string
}

export const FMI_ICLOUD_ON_OFF: FmiService = { serviceId: 3, serviceName: 'iCloud ON/OFF' }
export const FMI_MAC_ICLOUD: FmiService = { serviceId: 110, serviceName: 'Macbook & iMac iCloud ON/OFF Status' }

/**
 * Pick the SICKW FMI service for a device, inferred from any combination of
 * SKU / title / description text. Checks Mac tokens first. Returns null when the
 * device type can't be determined — callers should skip the check rather than
 * guess (avoids charging for a check against the wrong service).
 */
export function getFmiService(text: string | null | undefined): FmiService | null {
  const t = (text ?? '').toLowerCase()
  if (/imac|macbook|mbpro|mbair/.test(t)) return FMI_MAC_ICLOUD
  if (/iphone|ipad|apple\s*watch|awatch|\bwatch\b/.test(t)) return FMI_ICLOUD_ON_OFF
  return null
}

/**
 * Parse Find My / iCloud-lock ON/OFF from a SICKW result string. Handles the
 * "iCloud Lock: ON/OFF" (service 110 / legacy) and "Find My iPhone|iPad|Mac:
 * ON/OFF" (service 3) formats. Returns 'ON' | 'OFF' | null (indeterminate).
 */
export function parseFmiStatus(resultText: string | null | undefined): 'ON' | 'OFF' | null {
  if (!resultText) return null
  const patterns = [
    /iCloud Lock:\s*(?:<[^>]*>)?\s*(ON|OFF)/i,
    /Find My(?:\s*(?:iPhone|iPad|iPod|Mac))?:\s*(?:<[^>]*>)?\s*(ON|OFF)/i,
    /\bFMI:\s*(?:<[^>]*>)?\s*(ON|OFF)/i,
  ]
  for (const p of patterns) {
    const m = resultText.match(p)
    if (m) return m[1].toUpperCase() as 'ON' | 'OFF'
  }
  return null
}
