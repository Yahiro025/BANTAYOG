/**
 * AnalyticsService — read-only aggregations for the `/admin/analytics` tab.
 *
 * Every method here is a display-only aggregate over existing tables/Redis
 * counters (BANTAYOG's admin analytics tab makes no eligibility, tier,
 * balance, or settlement decision — see `.kiro/steering/product.md`). No
 * method here ever inserts, updates, or deletes application state.
 *
 * Contracts consumed: `packages/schema/src/analytics.ts`
 * (`AnalyticsTopProductsResponseDto`, `AnalyticsTierSpendDto`,
 * `AnalyticsVisionPerformanceDto`, `AnalyticsSecurityEventsDto`,
 * `DpaExportRowDto`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@bantayog/db'
import { type AppResult, ok, err, PersistenceError } from '../lib/errors.js'
import { getFoodGroupLabel } from '../domain/nutrition-policy.js'
import { readVisionPerformance, readSecurityEvents, readScanOutcomes } from '../lib/analytics-metrics.js'

export interface TopProductRow {
  productName: string
  category: string
  purchaseCount: number
  foodGroup: string
}

export interface TierSpendBucket {
  allocated: number
  spent: number
  beneficiaryCount: number
}

export interface TierSpend {
  tier1: TierSpendBucket
  tier2: TierSpendBucket
}

const CONFIRMED_LIKE_STATUSES = ['CONFIRMED', 'RECONCILED'] as const

/**
 * Reads a transaction's settled amount. `settle_sale` (the live purchase
 * RPC, migration 00004) writes `total_amount` — NOT `total_credit_deducted`
 * — so `total_credit_deducted` is only ever populated by the older
 * `TransactionService.createTransaction` outbox path. Every other read of
 * this value in the codebase (`dto/mappers.ts`, `routes/balance.ts`) uses
 * this same `total_amount ?? total_credit_deducted ?? 0` fallback; this
 * mirrors it so analytics totals do not silently under-count rows written
 * by `settle_sale`.
 */
function readSettledAmount(row: { total_amount?: unknown; total_credit_deducted?: unknown }): number {
  return Number((row as any).total_amount ?? (row as any).total_credit_deducted ?? 0)
}

export class AnalyticsService {
  constructor(private readonly db: SupabaseClient<Database>) {}

  /**
   * `GET /api/analytics/top-products?days=<n>` — aggregates purchase counts
   * per product name from `transactions.item_list_jsonb` for CONFIRMED and
   * RECONCILED transactions in the trailing `days` window. `category` and
   * `foodGroup` come from each line item's own `category` field (the same
   * 9-value nutrition enum validated at checkout time in
   * `routes/transactions.ts`), never from a re-lookup that could disagree
   * with what was actually charged.
   */
  async getTopProducts(days: number): Promise<AppResult<TopProductRow[]>> {
    try {
      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

      const { data, error } = await this.db
        .from('transactions')
        .select('item_list_jsonb, status, created_at')
        .in('status', CONFIRMED_LIKE_STATUSES as unknown as string[])
        .gte('created_at', sinceIso)

      if (error) {
        return err(new PersistenceError(`Failed to query transactions for top products: ${error.message}`, 'transactions'))
      }

      const counts = new Map<string, { category: string; purchaseCount: number }>()

      for (const row of data ?? []) {
        const items = Array.isArray((row as any).item_list_jsonb) ? (row as any).item_list_jsonb : []
        for (const item of items) {
          const name = typeof item?.name === 'string' ? item.name.trim() : ''
          const category = typeof item?.category === 'string' ? item.category : 'OTHER'
          if (!name) continue

          const key = `${name}::${category}`
          const existing = counts.get(key)
          if (existing) {
            existing.purchaseCount += 1
          } else {
            counts.set(key, { category, purchaseCount: 1 })
          }
        }
      }

      const rows: TopProductRow[] = Array.from(counts.entries())
        .map(([key, value]) => {
          const [productName] = key.split('::')
          return {
            productName,
            category: value.category,
            purchaseCount: value.purchaseCount,
            foodGroup: getFoodGroupLabel(value.category),
          }
        })
        .sort((left, right) => right.purchaseCount - left.purchaseCount)
        .slice(0, 20)

      return ok(rows)
    } catch (error: any) {
      return err(new PersistenceError(`getTopProducts failed: ${error.message}`, 'transactions'))
    }
  }

  /**
   * `GET /api/analytics/tier-spend` — for each tier, sums `allocations.amount_phpc`
   * (allocated) and `transactions.total_credit_deducted` for that tier's
   * beneficiaries (spent), and counts distinct beneficiaries with at least
   * one allocation. Grant amounts are read from the `allocations` table
   * (server-owned), never recomputed from `nutrition-policy.ts` constants.
   */
  async getTierSpend(): Promise<AppResult<TierSpend>> {
    try {
      const { data: allocationRows, error: allocationError } = await this.db
        .from('allocations')
        .select('beneficiary_id, tier, amount_phpc')

      if (allocationError) {
        return err(new PersistenceError(`Failed to query allocations for tier spend: ${allocationError.message}`, 'allocations'))
      }

      /* The connected database may not have the optional cached tier column
         from migration 00002. Allocation.tier is the authoritative tier at
         grant time and is enough to group both allocated and settled amounts. */
      const tierByBeneficiaryId = new Map<string, 1 | 2>()
      for (const row of allocationRows ?? []) {
        tierByBeneficiaryId.set((row as any).beneficiary_id as string, (row as any).tier === 2 ? 2 : 1)
      }

      const bucket: TierSpend = {
        tier1: { allocated: 0, spent: 0, beneficiaryCount: 0 },
        tier2: { allocated: 0, spent: 0, beneficiaryCount: 0 },
      }

      const allocatedBeneficiaryIdsByTier = { 1: new Set<string>(), 2: new Set<string>() }

      for (const row of allocationRows ?? []) {
        const tier: 1 | 2 = (row as any).tier === 2 ? 2 : 1
        const amount = Number((row as any).amount_phpc ?? 0)
        const beneficiaryId = (row as any).beneficiary_id as string

        if (tier === 1) {
          bucket.tier1.allocated += amount
        } else {
          bucket.tier2.allocated += amount
        }
        allocatedBeneficiaryIdsByTier[tier].add(beneficiaryId)
      }

      bucket.tier1.beneficiaryCount = allocatedBeneficiaryIdsByTier[1].size
      bucket.tier2.beneficiaryCount = allocatedBeneficiaryIdsByTier[2].size

      const { data: transactionRows, error: transactionError } = await this.db
        .from('transactions')
        .select('beneficiary_id, total_amount, status')
        .in('status', CONFIRMED_LIKE_STATUSES as unknown as string[])

      if (transactionError) {
        return err(new PersistenceError(`Failed to query transactions for tier spend: ${transactionError.message}`, 'transactions'))
      }

      for (const row of transactionRows ?? []) {
        const beneficiaryId = (row as any).beneficiary_id as string
        const tier = tierByBeneficiaryId.get(beneficiaryId)
        if (!tier) continue // beneficiary not found (e.g. deleted) — skip rather than guess

        const amount = readSettledAmount(row as any)
        if (tier === 1) {
          bucket.tier1.spent += amount
        } else {
          bucket.tier2.spent += amount
        }
      }

      return ok(bucket)
    } catch (error: any) {
      return err(new PersistenceError(`getTierSpend failed: ${error.message}`, 'beneficiaries'))
    }
  }

  /**
   * `GET /api/analytics/vision-performance` — reads the cumulative Redis
   * counters recorded by every `VisionService.analyzeScan` call
   * (`lib/analytics-metrics.ts`). Reports zero values (not an error) when no
   * scan has been recorded yet or Upstash is not configured.
   */
  async getVisionPerformance(): Promise<AppResult<{ avgLatencyMs: number; successRate: number }>> {
    const result = await readVisionPerformance()
    return ok(result)
  }

  /**
   * `GET /api/analytics/security-events` — reads the cumulative PIN
   * attempt/lockout Redis counters recorded by `PinService.verifyPinWithLockout`.
   */
  async getSecurityEvents(): Promise<AppResult<{ pinAttempts: number; lockouts: number }>> {
    const result = await readSecurityEvents()
    return ok(result)
  }

  /**
   * `GET /api/analytics/scan-outcomes` — reads the approved/rejected scan
   * counters recorded by `VisionService.analyzeScan`.
   */
  async getScanOutcomes(): Promise<AppResult<{
    approvedCount: number
    rejectedCount: number
    rejectionReasons: { reason: string; count: number }[]
  }>> {
    const result = await readScanOutcomes()
    return ok(result)
  }

  /**
   * `POST /api/analytics/dpa-export` data source — district-level aggregates
   * for the trailing `days` window. BANTAYOG's schema has no `district`
   * column on `beneficiaries` (see `data-model.md`), so every row is grouped
   * under the single configured LGU district label
   * (`LGU_DISTRICT_LABEL`, matching the label already shown in
   * `StatusBar`/`QrPassModal`) rather than fabricating a per-beneficiary
   * district that does not exist in the data. No guardian name, child name,
   * coordinate, or ungrouped age is read or returned.
   */
  async getDpaExportRows(days: number, districtLabel: string): Promise<AppResult<
    { district: string; beneficiaryCount: number; transactionCount: number; totalCreditDeducted: number }[]
  >> {
    try {
      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

      const { count: beneficiaryCount, error: beneficiaryError } = await this.db
        .from('beneficiaries')
        .select('id', { count: 'exact', head: true })

      if (beneficiaryError) {
        return err(new PersistenceError(`Failed to count beneficiaries for DPA export: ${beneficiaryError.message}`, 'beneficiaries'))
      }

      const { data: transactionRows, error: transactionError } = await this.db
        .from('transactions')
        .select('total_amount, status, created_at')
        .in('status', CONFIRMED_LIKE_STATUSES as unknown as string[])
        .gte('created_at', sinceIso)

      if (transactionError) {
        return err(new PersistenceError(`Failed to query transactions for DPA export: ${transactionError.message}`, 'transactions'))
      }

      const transactionCount = transactionRows?.length ?? 0
      const totalCreditDeducted = (transactionRows ?? []).reduce(
        (sum, row) => sum + readSettledAmount(row as any),
        0,
      )

      return ok([
        {
          district: districtLabel,
          beneficiaryCount: beneficiaryCount ?? 0,
          transactionCount,
          totalCreditDeducted,
        },
      ])
    } catch (error: any) {
      return err(new PersistenceError(`getDpaExportRows failed: ${error.message}`, 'transactions'))
    }
  }
}
