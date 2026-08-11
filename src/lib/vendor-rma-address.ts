/** Normalize the vendor RMA return-address fields from a request body into
 *  Prisma data (trimmed, empty → null; country defaults to US). Shared by the
 *  vendor create + update routes. */
export function rmaAddressData(body: Record<string, unknown>) {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    rmaName:     s(body.rmaName),
    rmaCompany:  s(body.rmaCompany),
    rmaAddress1: s(body.rmaAddress1),
    rmaAddress2: s(body.rmaAddress2),
    rmaCity:     s(body.rmaCity),
    rmaState:    s(body.rmaState),
    rmaPostal:   s(body.rmaPostal),
    rmaCountry:  s(body.rmaCountry) || 'US',
    rmaPhone:    s(body.rmaPhone),
  }
}
