import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetRedisClient } = vi.hoisted(() => ({ mockGetRedisClient: vi.fn() }))
vi.mock('./redis.js', () => ({ getRedisClient: mockGetRedisClient }))

const {
  recordPinAttempt,
  recordPinLockout,
  readSecurityEvents,
  recordVisionScan,
  readVisionPerformance,
} = await import('./analytics-metrics.js')

describe('analytics-metrics (Upstash-optional counters)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recordPinAttempt/recordPinLockout are no-ops when Redis is not configured', async () => {
    mockGetRedisClient.mockReturnValue(null)

    await expect(recordPinAttempt()).resolves.toBeUndefined()
    await expect(recordPinLockout()).resolves.toBeUndefined()
  })

  it('readSecurityEvents reports zero counts when Redis is not configured', async () => {
    mockGetRedisClient.mockReturnValue(null)

    await expect(readSecurityEvents()).resolves.toEqual({ pinAttempts: 0, lockouts: 0 })
  })

  it('readSecurityEvents reads the incremented counters back', async () => {
    const redis = { incr: vi.fn(), get: vi.fn() }
    redis.get.mockImplementation((key: string) =>
      key.includes('lockouts') ? Promise.resolve(1) : Promise.resolve(4),
    )
    mockGetRedisClient.mockReturnValue(redis)

    const result = await readSecurityEvents()

    expect(result).toEqual({ pinAttempts: 4, lockouts: 1 })
  })

  it('recordPinAttempt increments the pin-attempts counter', async () => {
    const redis = { incr: vi.fn() }
    mockGetRedisClient.mockReturnValue(redis)

    await recordPinAttempt()

    expect(redis.incr).toHaveBeenCalledWith('analytics:pin_attempts_total')
  })

  it('readVisionPerformance reports zero when no scan has ever been recorded', async () => {
    const redis = { get: vi.fn().mockResolvedValue(null) }
    mockGetRedisClient.mockReturnValue(redis)

    const result = await readVisionPerformance()

    expect(result).toEqual({ avgLatencyMs: 0, successRate: 0 })
  })

  it('readVisionPerformance computes average latency and success rate from cumulative counters', async () => {
    const redis = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key.includes('latency')) return Promise.resolve(8420)
        if (key.includes('success')) return Promise.resolve(9)
        if (key.includes('total')) return Promise.resolve(10)
        return Promise.resolve(null)
      }),
    }
    mockGetRedisClient.mockReturnValue(redis)

    const result = await readVisionPerformance()

    expect(result).toEqual({ avgLatencyMs: 842, successRate: 0.9 })
  })

  it('recordVisionScan increments total/success and adds to the latency sum', async () => {
    const redis = { incr: vi.fn(), incrbyfloat: vi.fn() }
    mockGetRedisClient.mockReturnValue(redis)

    await recordVisionScan({ success: true, latencyMs: 500 })

    expect(redis.incr).toHaveBeenCalledWith('analytics:vision_scans_total')
    expect(redis.incr).toHaveBeenCalledWith('analytics:vision_scans_success')
    expect(redis.incrbyfloat).toHaveBeenCalledWith('analytics:vision_latency_ms_total', 500)
  })

  it('recordVisionScan does not increment the success counter on failure', async () => {
    const redis = { incr: vi.fn(), incrbyfloat: vi.fn() }
    mockGetRedisClient.mockReturnValue(redis)

    await recordVisionScan({ success: false, latencyMs: 200 })

    expect(redis.incr).toHaveBeenCalledWith('analytics:vision_scans_total')
    expect(redis.incr).not.toHaveBeenCalledWith('analytics:vision_scans_success')
  })

  it('swallows Redis errors and never throws', async () => {
    const redis = { incr: vi.fn().mockRejectedValue(new Error('network down')) }
    mockGetRedisClient.mockReturnValue(redis)

    await expect(recordPinAttempt()).resolves.toBeUndefined()
  })
})
