/**
 * Analytics DTOs for the LGU Admin Portal ANALYTICS tab (`/admin/analytics`).
 *
 * BE1 owns the backend routes; FE1 consumes these contracts from `apps/web`.
 *
 * IMPORTANT — this file is deliberately SELF-CONTAINED (no relative imports).
 * `apps/web` consumes it directly through the `@bantayog/schema/analytics`
 * subpath. The package barrel (`./index.js`) cannot be bundled by Next because
 * the workspace packages are consumed as TypeScript source while using Node-ESM
 * `.js` specifiers, which the web bundler cannot resolve. Keeping this module
 * free of relative imports is what makes it importable from both surfaces.
 * Do not add a `./*.js` import here.
 *
 * Route status at the time of writing:
 *   IMPLEMENTED  GET  /api/transactions?summary=1   (privacy-safe projection)
 *   IMPLEMENTED  GET  /api/merchants?summary=1      (privacy-safe projection)
 *   IMPLEMENTED  GET  /api/chain/balance
 *   IMPLEMENTED  GET  /api/analytics/top-products
 *   IMPLEMENTED  GET  /api/analytics/scan-outcomes
 *   IMPLEMENTED  GET  /api/analytics/tier-spend
 *   IMPLEMENTED  GET  /api/analytics/vision-performance
 *   IMPLEMENTED  GET  /api/analytics/security-events
 *   IMPLEMENTED  POST /api/analytics/dpa-export
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Local enums
//
// These are intentionally re-declared instead of imported from
// `./transaction.js` / `./merchant.js` (see the self-contained note above).
// `AnalyticsTransactionStatusSchema` also matches the REAL
// `transactions.status` CHECK constraint, which `TransactionStatusSchema` in
// `./transaction.ts` does not (that one still lists the removed
// `DB_RECORDED`/`BROADCAST` values and omits `SUBMITTED`).
// ---------------------------------------------------------------------------

export const AnalyticsTransactionStatusSchema = z.enum([
  'PENDING_CHAIN',
  'SUBMITTED',
  'CONFIRMED',
  'RECONCILED',
  'FAILED',
])
export type AnalyticsTransactionStatus = z.infer<typeof AnalyticsTransactionStatusSchema>

export const AnalyticsMerchantStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
])
export type AnalyticsMerchantStatus = z.infer<typeof AnalyticsMerchantStatusSchema>

// ---------------------------------------------------------------------------
// Section A — Product & nutrition analytics
// ---------------------------------------------------------------------------

/**
 * One aggregated product row.
 * Source: `transactions.item_list_jsonb` joined to `products.category`.
 */
export const AnalyticsTopProductDto = z.object({
  productName: z.string().min(1),
  category: z.string().min(1),
  purchaseCount: z.number().int().nonnegative(),
  foodGroup: z.string().min(1),
}).strict()
export type AnalyticsTopProduct = z.infer<typeof AnalyticsTopProductDto>

/** `GET /api/analytics/top-products?days=<n>` response. */
export const AnalyticsTopProductsResponseDto = z.array(AnalyticsTopProductDto)
export type AnalyticsTopProductsResponse = z.infer<typeof AnalyticsTopProductsResponseDto>

/**
 * `GET /api/analytics/scan-outcomes` response. Counters are recorded by the
 * vision scan pipeline and read from the optional Upstash Redis metrics store.
 */
export const AnalyticsScanOutcomesDto = z.object({
  approvedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  rejectionReasons: z.array(z.object({
    reason: z.string().min(1),
    count: z.number().int().nonnegative(),
  }).strict()),
}).strict()
export type AnalyticsScanOutcomes = z.infer<typeof AnalyticsScanOutcomesDto>

/** Allocated and spent totals for one intervention tier, in PHPC. */
export const AnalyticsTierSpendBucketDto = z.object({
  allocated: z.number().nonnegative(),
  spent: z.number().nonnegative(),
  beneficiaryCount: z.number().int().nonnegative(),
}).strict()
export type AnalyticsTierSpendBucket = z.infer<typeof AnalyticsTierSpendBucketDto>

/**
 * `GET /api/analytics/tier-spend` response.
 * The server owns the grant amounts (Tier 1 = 5,000 PHPC, Tier 2 = 3,500 PHPC);
 * the client only charts allocated against spent and never recomputes them.
 */
export const AnalyticsTierSpendDto = z.object({
  tier1: AnalyticsTierSpendBucketDto,
  tier2: AnalyticsTierSpendBucketDto,
}).strict()
export type AnalyticsTierSpend = z.infer<typeof AnalyticsTierSpendDto>

// ---------------------------------------------------------------------------
// Section B — Merchant & system performance
// ---------------------------------------------------------------------------

/**
 * `GET /api/analytics/vision-performance` response.
 * `successRate` is a fraction from 0 to 1. There is deliberately no
 * confidence-score field: the Gemini response shape has none.
 */
export const AnalyticsVisionPerformanceDto = z.object({
  avgLatencyMs: z.number().nonnegative(),
  successRate: z.number().min(0).max(1),
}).strict()
export type AnalyticsVisionPerformance = z.infer<typeof AnalyticsVisionPerformanceDto>

/**
 * `GET /api/analytics/security-events` response.
 * Counters come from the Upstash Redis sliding windows, not Postgres.
 */
export const AnalyticsSecurityEventsDto = z.object({
  pinAttempts: z.number().int().nonnegative(),
  lockouts: z.number().int().nonnegative(),
}).strict()
export type AnalyticsSecurityEvents = z.infer<typeof AnalyticsSecurityEventsDto>

// ---------------------------------------------------------------------------
// Privacy-safe projections of the existing admin endpoints
// ---------------------------------------------------------------------------

/**
 * `GET /api/transactions?summary=1` row.
 *
 * This projection exists because the default `TransactionDTO` embeds
 * `beneficiary.childName`, `beneficiary.guardianName`, `beneficiary.cardSerial`,
 * `merchant.ownerName`, `merchant.mobileNumberE164` and the full item list.
 * None of that may reach the analytics tab, so the server strips it before
 * responding rather than the client hiding it after the fact.
 *
 * `createdAt` is an ISO 8601 timestamp. It is typed as a plain string because
 * Postgres `timestamptz` serialises with a numeric offset (`+00:00`) in some
 * paths and with `Z` in others.
 */
export const AnalyticsTransactionSummaryDto = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  totalCreditDeducted: z.number().nonnegative(),
  onchainTxHash: z.string().nullable(),
  status: AnalyticsTransactionStatusSchema,
  createdAt: z.string().min(1),
}).strict()
export type AnalyticsTransactionSummary = z.infer<typeof AnalyticsTransactionSummaryDto>

export const PaginatedAnalyticsTransactionSummaryDto = z.object({
  data: z.array(AnalyticsTransactionSummaryDto),
  count: z.number().int().nonnegative(),
}).strict()
export type PaginatedAnalyticsTransactionSummary = z.infer<typeof PaginatedAnalyticsTransactionSummaryDto>

/**
 * `GET /api/merchants?summary=1` row. Carries no store name, owner name,
 * mobile number, wallet address, or wallet balance.
 */
export const AnalyticsMerchantSummaryDto = z.object({
  id: z.string().uuid(),
  status: AnalyticsMerchantStatusSchema,
}).strict()
export type AnalyticsMerchantSummary = z.infer<typeof AnalyticsMerchantSummaryDto>

export const PaginatedAnalyticsMerchantSummaryDto = z.object({
  data: z.array(AnalyticsMerchantSummaryDto),
  count: z.number().int().nonnegative(),
}).strict()
export type PaginatedAnalyticsMerchantSummary = z.infer<typeof PaginatedAnalyticsMerchantSummaryDto>

/** Existing `GET /api/chain/balance` response, used by the settlement widget. */
export const AnalyticsChainBalanceDto = z.object({
  address: z.string().min(1),
  balance: z.string(),
  formatted: z.string(),
}).strict()
export type AnalyticsChainBalance = z.infer<typeof AnalyticsChainBalanceDto>

// ---------------------------------------------------------------------------
// DPA-compliant export
// ---------------------------------------------------------------------------

export const DpaExportFormatSchema = z.enum(['csv', 'json'])
export type DpaExportFormat = z.infer<typeof DpaExportFormatSchema>

/** `POST /api/analytics/dpa-export` request body. */
export const DpaExportRequestDto = z.object({
  format: DpaExportFormatSchema,
  days: z.number().int().positive().max(3650),
}).strict()
export type DpaExportRequest = z.infer<typeof DpaExportRequestDto>

/**
 * One export row. District-level aggregates only: no guardian name, child name,
 * coordinates, or ungrouped `child_age_months` may appear in this contract.
 */
export const DpaExportRowDto = z.object({
  district: z.string().min(1),
  beneficiaryCount: z.number().int().nonnegative(),
  transactionCount: z.number().int().nonnegative(),
  totalCreditDeducted: z.number().nonnegative(),
}).strict()
export type DpaExportRow = z.infer<typeof DpaExportRowDto>

/** `POST /api/analytics/dpa-export` response when `format` is `json`. */
export const DpaExportJsonResponseDto = z.object({
  rows: z.array(DpaExportRowDto),
}).strict()
export type DpaExportJsonResponse = z.infer<typeof DpaExportJsonResponseDto>

/**
 * Required CSV header line, in this exact order, when `format` is `csv`.
 * The client refuses to download a CSV whose header differs, so an accidental
 * PII column is rejected instead of being saved to disk.
 */
export const DpaExportCsvHeaders = [
  'district',
  'beneficiaryCount',
  'transactionCount',
  'totalCreditDeducted',
] as const
