/**
 * Next.js instrumentation hook — called once when the server process starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Dynamic import keeps heavy modules (Prisma, SP-API client) out of the
 * initial bundle and ensures they only load in the Node.js runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { scheduleAutoSync } = await import('@/lib/auto-sync')
    scheduleAutoSync()

    const { scheduleAddressEnrichment } = await import('@/lib/address-enrichment')
    scheduleAddressEnrichment()
  }
}
