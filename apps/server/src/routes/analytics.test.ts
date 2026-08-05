import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ok, err } from 'neverthrow'
import { PersistenceError } from '../lib/errors.js'

// `createServiceClient` just needs to resolve to *something*; every method
// under test is mocked at the `AnalyticsService` level below.
vi.mock('../lib/supabase.js', () => ({
  createServiceClient: vi.fn().mockReturnValue({}),
}))

const mockGetTopProducts = vi.fn()
const mockGetTierSpend = vi.fn()
const mockGetVisionPerformance = vi.fn()
const mockGetSecurityEvents = vi.fn()
const mockGetScanOutcomes = vi.fn()
const mockGetDpaExportRows = vi.fn()

vi.mock('../services/analytics.service.js', () => ({
  AnalyticsService: vi.fn().mockImplementation(() => ({
    getTopProducts: mockGetTopProducts,
    getTierSpend: mockGetTierSpend,
    getVisionPerformance: mockGetVisionPerformance,
    getSecurityEvents: mockGetSecurityEvents,
    getScanOutcomes: mockGetScanOutcomes,
    getDpaExportRows: mockGetDpaExportRows,
  })),
}))

const { default: analyticsRoutes } = await import('./analytics.js')

describe('analytics routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.LGU_DISTRICT_LABEL
  })

  it('GET /top-products returns 200 with the aggregated rows', async () => {
    mockGetTopProducts.mockResolvedValue(ok([{ productName: 'Malunggay', category: 'VEGETABLES', purchaseCount: 3, foodGroup: 'Fruits & Vegetables' }]))

    const res = await analyticsRoutes.request('/top-products?days=30')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([{ productName: 'Malunggay', category: 'VEGETABLES', purchaseCount: 3, foodGroup: 'Fruits & Vegetables' }])
    expect(mockGetTopProducts).toHaveBeenCalledWith(30)
  })

  it('GET /top-products defaults to 30 days on an invalid query param', async () => {
    mockGetTopProducts.mockResolvedValue(ok([]))

    await analyticsRoutes.request('/top-products?days=not-a-number')

    expect(mockGetTopProducts).toHaveBeenCalledWith(30)
  })

  it('GET /top-products maps a persistence error to its stable HTTP status', async () => {
    mockGetTopProducts.mockResolvedValue(err(new PersistenceError('boom', 'transactions')))

    const res = await analyticsRoutes.request('/top-products')

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('persistence')
  })

  it('GET /scan-outcomes returns the persisted counters', async () => {
    const outcomes = {
      approvedCount: 3,
      rejectedCount: 2,
      rejectionReasons: [{ reason: 'Blurry photo', count: 2 }],
    }
    mockGetScanOutcomes.mockResolvedValue(ok(outcomes))

    const res = await analyticsRoutes.request('/scan-outcomes')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(outcomes)
  })

  it('GET /tier-spend returns 200 with the tier buckets', async () => {
    const spend = {
      tier1: { allocated: 5000, spent: 120, beneficiaryCount: 1 },
      tier2: { allocated: 3500, spent: 0, beneficiaryCount: 1 },
    }
    mockGetTierSpend.mockResolvedValue(ok(spend))

    const res = await analyticsRoutes.request('/tier-spend')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(spend)
  })

  it('GET /vision-performance returns 200 with the counters', async () => {
    mockGetVisionPerformance.mockResolvedValue(ok({ avgLatencyMs: 842, successRate: 0.9 }))

    const res = await analyticsRoutes.request('/vision-performance')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ avgLatencyMs: 842, successRate: 0.9 })
  })

  it('GET /security-events returns 200 with the counters', async () => {
    mockGetSecurityEvents.mockResolvedValue(ok({ pinAttempts: 4, lockouts: 1 }))

    const res = await analyticsRoutes.request('/security-events')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pinAttempts: 4, lockouts: 1 })
  })

  it('POST /dpa-export with format=json returns a rows envelope', async () => {
    mockGetDpaExportRows.mockResolvedValue(
      ok([{ district: 'Metro Manila City - District 2 (Municipal Nutrition Office)', beneficiaryCount: 10, transactionCount: 5, totalCreditDeducted: 500 }]),
    )

    const res = await analyticsRoutes.request('/dpa-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'json', days: 30 }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(Object.keys(body.rows[0]).sort()).toEqual(['beneficiaryCount', 'district', 'totalCreditDeducted', 'transactionCount'])
    expect(mockGetDpaExportRows).toHaveBeenCalledWith(30, 'Metro Manila City - District 2 (Municipal Nutrition Office)')
  })

  it('POST /dpa-export with format=csv returns the exact required header line', async () => {
    mockGetDpaExportRows.mockResolvedValue(
      ok([{ district: 'Metro Manila City - District 2 (Municipal Nutrition Office)', beneficiaryCount: 10, transactionCount: 5, totalCreditDeducted: 500 }]),
    )

    const res = await analyticsRoutes.request('/dpa-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'csv', days: 30 }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    const text = await res.text()
    const [header] = text.split('\n')
    expect(header).toBe('district,beneficiaryCount,transactionCount,totalCreditDeducted')
  })

  it('POST /dpa-export rejects an invalid body with a 400', async () => {
    const res = await analyticsRoutes.request('/dpa-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'xml', days: 30 }),
    })

    expect(res.status).toBe(400)
    expect(mockGetDpaExportRows).not.toHaveBeenCalled()
  })

  it('POST /dpa-export uses LGU_DISTRICT_LABEL when configured', async () => {
    process.env.LGU_DISTRICT_LABEL = 'Custom District Label'
    mockGetDpaExportRows.mockResolvedValue(ok([]))

    await analyticsRoutes.request('/dpa-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'json', days: 7 }),
    })

    expect(mockGetDpaExportRows).toHaveBeenCalledWith(7, 'Custom District Label')
  })
})
