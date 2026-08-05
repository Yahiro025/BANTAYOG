import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnalyticsService } from './analytics.service.js'

// `lib/analytics-metrics.ts` wraps Upstash Redis; mocked here so
// getVisionPerformance/getSecurityEvents are unit-testable without a real
// Redis client (mirrors the Upstash-optional convention used throughout
// the codebase — see `lib/redis.ts`). `vi.mock` factories are hoisted above
// imports, so the mock functions must be created via `vi.hoisted`.
const { mockReadVisionPerformance, mockReadSecurityEvents, mockReadScanOutcomes } = vi.hoisted(() => ({
  mockReadVisionPerformance: vi.fn(),
  mockReadSecurityEvents: vi.fn(),
  mockReadScanOutcomes: vi.fn(),
}))
vi.mock('../lib/analytics-metrics.js', () => ({
  readVisionPerformance: mockReadVisionPerformance,
  readSecurityEvents: mockReadSecurityEvents,
  readScanOutcomes: mockReadScanOutcomes,
}))

/**
 * Minimal chainable Supabase query builder mock. Each `.from(table)` call
 * looks up canned `{ data, error }` (and `{ count }` when relevant) from a
 * per-test `responses` map keyed by table name, in call order.
 */
function createMockDb(responsesByTable: Record<string, Array<{ data?: any; error?: any; count?: number }>>) {
  const callIndex: Record<string, number> = {}

  const from = vi.fn().mockImplementation((table: string) => {
    const index = callIndex[table] ?? 0
    callIndex[table] = index + 1
    const responses = responsesByTable[table] ?? []
    const response = responses[index] ?? { data: [], error: null }

    const chain: any = {
      select: vi.fn().mockImplementation((_cols: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) {
          return Promise.resolve({ count: response.count ?? 0, error: response.error ?? null })
        }
        return chain
      }),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockImplementation(() => Promise.resolve({ data: response.data ?? [], error: response.error ?? null })),
      then: (onFulfilled: any) =>
        Promise.resolve({ data: response.data ?? [], error: response.error ?? null }).then(onFulfilled),
    }
    return chain
  })

  return { from } as any
}

describe('AnalyticsService.getTopProducts', () => {
  it('aggregates purchase counts per product name across CONFIRMED/RECONCILED transactions', async () => {
    const db = createMockDb({
      transactions: [
        {
          data: [
            { item_list_jsonb: [{ name: 'Malunggay', category: 'VEGETABLES' }, { name: 'Rice', category: 'GRAINS' }] },
            { item_list_jsonb: [{ name: 'Malunggay', category: 'VEGETABLES' }] },
          ],
          error: null,
        },
      ],
    })
    const service = new AnalyticsService(db)

    const result = await service.getTopProducts(30)

    expect(result.isOk()).toBe(true)
    const rows = result._unsafeUnwrap()
    expect(rows[0]).toEqual({ productName: 'Malunggay', category: 'VEGETABLES', purchaseCount: 2, foodGroup: 'Fruits & Vegetables' })
    expect(rows[1]).toEqual({ productName: 'Rice', category: 'GRAINS', purchaseCount: 1, foodGroup: 'Grains & Cereals' })
  })

  it('returns a persistence error when the query fails', async () => {
    const db = createMockDb({
      transactions: [{ data: null, error: { message: 'db down' } }],
    })
    const service = new AnalyticsService(db)

    const result = await service.getTopProducts(30)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()._tag).toBe('persistence')
  })

  it('ignores malformed item entries instead of throwing', async () => {
    const db = createMockDb({
      transactions: [
        { data: [{ item_list_jsonb: [{ name: '' }, { category: 'GRAINS' }, null] }], error: null },
      ],
    })
    const service = new AnalyticsService(db)

    const result = await service.getTopProducts(30)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([])
  })
})

describe('AnalyticsService.getTierSpend', () => {
  it('sums allocated and spent amounts per tier using settled transaction amounts', async () => {
    const db = createMockDb({
      beneficiaries: [{ data: [{ id: 'b1', intervention_tier: 1 }, { id: 'b2', intervention_tier: 2 }], error: null }],
      allocations: [{ data: [{ beneficiary_id: 'b1', tier: 1, amount_phpc: 5000 }, { beneficiary_id: 'b2', tier: 2, amount_phpc: 3500 }], error: null }],
      transactions: [{ data: [{ beneficiary_id: 'b1', total_amount: 120 }, { beneficiary_id: 'b2', total_credit_deducted: 80 }], error: null }],
    })
    const service = new AnalyticsService(db)

    const result = await service.getTierSpend()

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      tier1: { allocated: 5000, spent: 120, beneficiaryCount: 1 },
      tier2: { allocated: 3500, spent: 80, beneficiaryCount: 1 },
    })
  })

  it('skips transactions for beneficiaries with no matching record', async () => {
    const db = createMockDb({
      beneficiaries: [{ data: [], error: null }],
      allocations: [{ data: [], error: null }],
      transactions: [{ data: [{ beneficiary_id: 'ghost', total_amount: 999 }], error: null }],
    })
    const service = new AnalyticsService(db)

    const result = await service.getTierSpend()

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().tier1.spent).toBe(0)
    expect(result._unsafeUnwrap().tier2.spent).toBe(0)
  })
})

describe('AnalyticsService.getVisionPerformance / getSecurityEvents', () => {
  beforeEach(() => {
    mockReadVisionPerformance.mockReset()
    mockReadSecurityEvents.mockReset()
  })

  it('returns the value read from the Redis counters', async () => {
    mockReadVisionPerformance.mockResolvedValue({ avgLatencyMs: 842, successRate: 0.93 })
    const service = new AnalyticsService({} as any)

    const result = await service.getVisionPerformance()

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({ avgLatencyMs: 842, successRate: 0.93 })
  })

  it('returns zeroed security events when no counters exist yet', async () => {
    mockReadSecurityEvents.mockResolvedValue({ pinAttempts: 0, lockouts: 0 })
    const service = new AnalyticsService({} as any)

    const result = await service.getSecurityEvents()

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({ pinAttempts: 0, lockouts: 0 })
  })
  it('returns the persisted scan outcome counters', async () => {
    mockReadScanOutcomes.mockResolvedValue({
      approvedCount: 3,
      rejectedCount: 2,
      rejectionReasons: [{ reason: 'Blurry photo', count: 2 }],
    })
    const service = new AnalyticsService({} as any)

    const result = await service.getScanOutcomes()

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      approvedCount: 3,
      rejectedCount: 2,
      rejectionReasons: [{ reason: 'Blurry photo', count: 2 }],
    })
  })
})

describe('AnalyticsService.getDpaExportRows', () => {
  it('returns one district-level aggregate row with no PII fields', async () => {
    const db = createMockDb({
      beneficiaries: [{ data: [], error: null, count: 42 }],
      transactions: [{ data: [{ total_amount: 100 }, { total_amount: 50, total_credit_deducted: 0 }], error: null }],
    })
    const service = new AnalyticsService(db)

    const result = await service.getDpaExportRows(30, 'Metro Manila City - District 2 (Municipal Nutrition Office)')

    expect(result.isOk()).toBe(true)
    const rows = result._unsafeUnwrap()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      district: 'Metro Manila City - District 2 (Municipal Nutrition Office)',
      beneficiaryCount: 42,
      transactionCount: 2,
      totalCreditDeducted: 150,
    })
    expect(Object.keys(rows[0]).sort()).toEqual(['beneficiaryCount', 'district', 'totalCreditDeducted', 'transactionCount'])
  })
})
