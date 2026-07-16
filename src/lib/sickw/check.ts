/**
 * Server-side SICKW call helper with self-correcting FMI routing.
 *
 * Device-type routing from SKU/title text (see getFmiService) can misfire when a
 * SKU is obfuscated and the title is missing — e.g. an iMac routed to "iCloud
 * ON/OFF" (service 3), which SICKW rejects with "Only iPhone & iPad supported".
 * When an Apple iCloud service returns that device-class rejection, we retry
 * once with its complement (iCloud ON/OFF ↔ Macbook & iMac iCloud) so the check
 * still resolves to a real ON/OFF instead of a wasted UNKNOWN.
 *
 * Server-only (performs network + reads env); do not import into client bundles.
 */

const FMI_COMPLEMENT: Record<number, { id: number; name: string }> = {
  3: { id: 110, name: 'Macbook & iMac iCloud ON/OFF Status' },
  110: { id: 3, name: 'iCloud ON/OFF' },
}

/** True when SICKW rejected the check because the identifier is the wrong device
 *  class for the service (so retrying the complementary service makes sense). */
function isWrongDeviceRejection(data: unknown): boolean {
  const d = data as { result?: unknown; status?: unknown }
  const status = String(d?.status ?? '').toLowerCase()
  const text = typeof d?.result === 'string' ? d.result.toLowerCase() : ''
  if (status === 'rejected') return true
  return /only\s+(iphone|ipad|macbook|imac|mac)\b|supported on this service|not supported/.test(text)
}

async function callSickw(apiKey: string, imei: string, serviceId: number): Promise<unknown> {
  const url = `https://sickw.com/api.php?format=json&key=${encodeURIComponent(apiKey)}&imei=${encodeURIComponent(imei)}&service=${serviceId}`
  const res = await fetch(url, { cache: 'no-store' })
  return res.json()
}

export interface SickwCheckResult {
  data: unknown
  serviceId: number
  serviceName: string
  status: 'success' | 'error'
  /** true when the complementary service was used after a device-class rejection */
  autoCorrected: boolean
}

/**
 * Run a SICKW check, auto-correcting an Apple FMI device-class misroute once.
 * Returns the data + the service actually used so callers persist the right one.
 */
export async function runSickwCheck(
  apiKey: string,
  imei: string,
  serviceId: number,
  serviceName: string,
): Promise<SickwCheckResult> {
  let data = await callSickw(apiKey, imei, serviceId)
  let usedId = serviceId
  let usedName = serviceName
  let autoCorrected = false

  const comp = FMI_COMPLEMENT[serviceId]
  if (comp && isWrongDeviceRejection(data)) {
    const alt = await callSickw(apiKey, imei, comp.id)
    if (!isWrongDeviceRejection(alt)) {
      data = alt
      usedId = comp.id
      usedName = comp.name
      autoCorrected = true
    }
  }

  const s = (data as { status?: unknown })?.status
  const status = s === 'success' || s === 'Success' ? 'success' : 'error'
  return { data, serviceId: usedId, serviceName: usedName, status, autoCorrected }
}
