# Amazon Refund Auditor — MVP

A full-stack web app for auditing Amazon Seller Central refunds via SP-API.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Next.js React)                                    │
│  /refunds   → RefundTable (filters, sort, bulk select)      │
│  /dashboard → Stats & recent imports                        │
│  /audit     → AuditLog (search, CSV export)                 │
│  /connect   → Amazon OAuth flow                             │
└─────────────────┬───────────────────────────────────────────┘
                  │  HTTPS
┌─────────────────▼───────────────────────────────────────────┐
│  Next.js API Routes (App Router)                            │
│  POST /api/accounts          → initiate LWA consent URL     │
│  GET  /api/accounts/callback → exchange code, store tokens  │
│  POST /api/refunds/import    → pull SP-API, upsert DB       │
│  GET  /api/refunds           → list with filters/pagination │
│  POST /api/refunds/:id       → submit review                │
│  POST /api/refunds/bulk-review → bulk review                │
│  GET  /api/audit             → audit log                    │
│  GET  /api/audit/export      → CSV download                 │
└──────────┬──────────────────────────┬───────────────────────┘
           │ Prisma ORM               │ Axios
┌──────────▼──────────┐  ┌───────────▼───────────────────────┐
│  PostgreSQL          │  │  Amazon SP-API                    │
│  - users             │  │  GET /finances/v0/financialEvents  │
│  - amazon_accounts   │  │    → RefundEventList (refunds)    │
│  - refunds           │  │  GET /orders/v0/orders/{id}       │
│  - reviews           │  │    → FulfillmentChannel (FBA/MFN) │
│  - audit_events      │  │  POST api.amazon.com/auth/o2/token│
│  - import_jobs       │  │    → LWA token refresh            │
└─────────────────────┘  └───────────────────────────────────┘
```

## SP-API Endpoints Used

### 1. Finances API v0 — `GET /finances/v0/financialEvents`
**What it provides:** All financial events in a date range including `RefundEventList`.

Each `ShipmentEvent` in `RefundEventList` represents one order's refund.
Inside each event, `ShipmentItemAdjustmentList[]` contains per-line-item adjustments:
- `AdjustmentId` — our idempotency key per refund line
- `SellerSKU`, `ASIN` — product identifiers
- `ItemChargeAdjustmentList[]` — charge components (Principal, Shipping, Tax)
  - Refund amount = sum of all `ChargeAmount.CurrencyAmount`

**Required SP-API role:** `Selling partner insights` (grants `sellingpartnerapi:finances`)
**Rate limit:** 0.5 req/s, burst 30. We sleep 2.1s between paginated calls.
**Pagination:** `NextToken` in response → resend until absent.

### 2. Orders API v0 — `GET /orders/v0/orders/{orderId}`
**What it provides:** `FulfillmentChannel` = `"AFN"` (FBA) or `"MFN"` (merchant).

We batch-fetch one call per unique orderId found in refund events.
Falls back to `UNKNOWN` on any per-order error (prevents one failure blocking the whole import).

**Required SP-API role:** `Direct-to-consumer shipping` (grants `orders:read`)
**Rate limit:** 0.5 req/s, burst 30. We sleep 2.1s between calls.

### Fallback (no SP-API access)
If you cannot obtain SP-API credentials, export from Seller Central:
`Reports → Returns → date range` downloads a CSV. A future endpoint
`POST /api/refunds/upload-csv` can ingest that format with identical upsert logic.

## Database Schema (Prisma)

```
AmazonAccount  (sellerId, marketplaceId, encrypted tokens)
     │
     ├── ImportJob  (startDate, endDate, status, counts)
     │
     └── Refund     (orderId, adjustmentId ← unique key)
              │
              ├── Review      (status, invalidReason, notes, reviewedBy)
              └── AuditEvent  (action, before, after, actor, timestamp)
```

## Re-import / Deduplication Policy

| Scenario | Behavior |
|---|---|
| New refund line | Insert + create UNREVIEWED Review |
| Existing, UNREVIEWED | Overwrite all fields |
| Existing, VALID or INVALID | Update raw data (sku, asin, amount) but preserve review state |
| Amount changed ≥ $0.01 | Write `REFUND_AMOUNT_CHANGED` AuditEvent so reviewers are notified |

## Local Setup

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Amazon Developer account (for real SP-API; seed data works without it)

### Steps

```bash
# 1. Clone and install
cd amazon-refund-auditor
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/refund_auditor
#   NEXTAUTH_SECRET=$(openssl rand -base64 32)
#   ENCRYPTION_KEY=$(openssl rand -hex 32)
#   AMAZON_APP_ID=...
#   AMAZON_CLIENT_ID=...
#   AMAZON_CLIENT_SECRET=...

# 3. Create database and run migrations
createdb refund_auditor          # or via psql
npm run db:migrate               # applies schema
npm run db:seed                  # creates demo users + 5 refunds

# 4. Start development server
npm run dev
# → http://localhost:3000

# 5. Login
#   Admin:    admin@example.com / admin123
#   Reviewer: reviewer@example.com / reviewer123
```

### Connect Amazon (for real SP-API data)

1. Register an app at https://developer.amazon.com/apps/manage
2. Under OAuth → add redirect URI: `http://localhost:3000/api/accounts/callback`
3. Request roles: **Selling partner insights** + **Direct-to-consumer shipping**
4. Add `AMAZON_APP_ID`, `AMAZON_CLIENT_ID`, `AMAZON_CLIENT_SECRET` to `.env`
5. In the app: go to `/connect` → "Connect via Amazon" → authorize in Seller Central

### Import Refunds

1. Go to `/refunds` → click **Import**
2. Select account, choose date range (max ~30 days per call recommended)
3. System pulls Finances API + enriches with Orders API for FBA/MFN
4. Idempotent — safe to run multiple times for the same range

### Review Workflow

- **Single review:** click any row → detail panel → mark Valid / Invalid + reason
- **Bulk review:** check multiple rows → "Bulk Review" button → choose status + reason
- **Invalid reasons** (taxonomy):
  - Customer returned different item
  - Return never received
  - Refund issued outside policy window
  - Wrong SKU/ASIN — mismatch
  - Duplicate refund
  - Shipping not returned / no tracking
  - Chargeback related — handle elsewhere
  - Other (requires free-text explanation)

### Audit Log

- Go to `/audit` to see all review changes and imports
- Filter by search term, date range, or action type
- Export full log as CSV via **Export CSV** button

## API Reference

### GET /api/refunds
```
?page=1&pageSize=25&sortBy=postedDate&sortDir=desc
&startDate=2024-01-01T00:00:00Z
&endDate=2024-01-31T23:59:59Z
&fulfillment=FBA           # FBA | MFN | UNKNOWN
&status=UNREVIEWED         # UNREVIEWED | VALID | INVALID
&search=113-123            # orderId, sku, asin, adjustmentId partial match

Response: { data: Refund[], pagination: { page, pageSize, total, totalPages } }
```

### POST /api/refunds/:id (review)
```json
// Mark valid
{ "status": "VALID", "notes": "Confirmed return received" }

// Mark invalid
{
  "status": "INVALID",
  "invalidReason": "DIFFERENT_ITEM_RETURNED",
  "notes": "Customer returned a chair, we sold a lamp"
}

// Mark invalid - other
{
  "status": "INVALID",
  "invalidReason": "OTHER",
  "customReason": "Explain here (required)",
  "notes": "Optional extra notes"
}
```

### POST /api/refunds/bulk-review
```json
{
  "refundIds": ["id1", "id2", "id3"],
  "status": "INVALID",
  "invalidReason": "RETURN_NEVER_RECEIVED",
  "notes": "Batch flagged after carrier audit"
}
```

### POST /api/refunds/import
```json
{
  "accountId": "cld...",
  "startDate": "2024-11-01T00:00:00.000Z",
  "endDate": "2024-11-30T23:59:59.000Z"
}
```

## Tests

```bash
npm test
# Runs: crypto roundtrip, sumCharges, deduplication key tests
```

## Production Considerations

| Concern | Recommendation |
|---|---|
| Async imports | Move import to BullMQ/Inngest queue; return jobId immediately |
| Token storage | Use AWS KMS or Vault instead of env-key AES |
| Rate limits | Add Redis token-bucket per sellerId |
| Multi-tenant | Add org/team isolation layer around AmazonAccount |
| Role enforcement | Middleware checking `session.user.role` before ADMIN routes |
| CSV export | Stream large exports with `csv-stringify` Transform stream |
