/**
 * Lightweight Upstash Redis counters backing the two analytics widgets that
 * cannot be derived from Postgres:
 *   - AI Vision Performance (`GET /api/analytics/vision-performance`)
 *   - PIN Lockout & Security Alerts (`GET /api/analytics/security-events`)
 *
 * These are cumulative, process-independent counters, distinct from
 * `pin.service.ts`'s transient `pin_fail:{id}` / `pin_lock:{id}` lockout
 * state (which is reset on success/lockout and scoped per beneficiary).
 * The Gemini response has no confidence field, so no confidence-score
 * metric is ever recorded or reported here.
 *
 * If Upstash is not configured, every write is a no-op and every read
 * reports zero counts (the codebase's established Upstash-optional
 * convention — see `lib/redis.ts`), so a missing Redis config never
 * fabricates or blocks these figures.
 */
import { getRedisClient } from './redis.js'

const PIN_ATTEMPTS_TOTAL_KEY = 'analytics:pin_attempts_total'
const PIN_LOCKOUTS_TOTAL_KEY = 'analytics:pin_lockouts_total'
const VISION_SCANS_TOTAL_KEY = 'analytics:vision_scans_total'
const VISION_SCANS_SUCCESS_KEY = 'analytics:vision_scans_success'
const VISION_LATENCY_MS_TOTAL_KEY = 'analytics:vision_latency_ms_total'
const SCAN_APPROVED_TOTAL_KEY = 'analytics:scan_approved_total'
const SCAN_REJECTED_TOTAL_KEY = 'analytics:scan_rejected_total'
const SCAN_REJECTION_REASON_KEYS = [
  { key: 'blurry', label: 'Blurry photo' },
  { key: 'unrecognized', label: 'Unrecognized product' },
  { key: 'ineligible', label: 'Ineligible product' },
  { key: 'error', label: 'Scan error' },
] as const

/** Records one PIN verification attempt (Requirement: PIN security telemetry). */
export async function recordPinAttempt(): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.incr(PIN_ATTEMPTS_TOTAL_KEY)
  } catch (error) {
    console.warn('[analytics-metrics] Failed to record PIN attempt:', error)
  }
}

/** Records one PIN lockout event. */
export async function recordPinLockout(): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.incr(PIN_LOCKOUTS_TOTAL_KEY)
  } catch (error) {
    console.warn('[analytics-metrics] Failed to record PIN lockout:', error)
  }
}

/** Reads the cumulative PIN attempt/lockout counters. Zero if unavailable. */
export async function readSecurityEvents(): Promise<{ pinAttempts: number; lockouts: number }> {
  const redis = getRedisClient()
  if (!redis) return { pinAttempts: 0, lockouts: 0 }
  try {
    const [pinAttempts, lockouts] = await Promise.all([
      redis.get<number>(PIN_ATTEMPTS_TOTAL_KEY),
      redis.get<number>(PIN_LOCKOUTS_TOTAL_KEY),
    ])
    return { pinAttempts: pinAttempts ?? 0, lockouts: lockouts ?? 0 }
  } catch (error) {
    console.warn('[analytics-metrics] Failed to read security events:', error)
    return { pinAttempts: 0, lockouts: 0 }
  }
}

/** Records one approved/rejected scan outcome for the scan-outcomes widget. */
export async function recordScanOutcome(params: { approved: boolean; rejectionReason?: string }): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    if (params.approved) {
      await redis.incr(SCAN_APPROVED_TOTAL_KEY)
      return
    }

    const reason = SCAN_REJECTION_REASON_KEYS.find((entry) => entry.key === params.rejectionReason)?.key ?? 'error'
    await Promise.all([
      redis.incr(SCAN_REJECTED_TOTAL_KEY),
      redis.incr(`analytics:scan_rejected_${reason}_total`),
    ])
  } catch (error) {
    console.warn('[analytics-metrics] Failed to record scan outcome:', error)
  }
}

/** Reads approved/rejected scan counters and their persisted rejection reasons. */
export async function readScanOutcomes(): Promise<{
  approvedCount: number
  rejectedCount: number
  rejectionReasons: { reason: string; count: number }[]
}> {
  const redis = getRedisClient()
  if (!redis) return { approvedCount: 0, rejectedCount: 0, rejectionReasons: [] }

  try {
    const [approvedCount, rejectedCount, ...reasonCounts] = await Promise.all([
      redis.get<number>(SCAN_APPROVED_TOTAL_KEY),
      redis.get<number>(SCAN_REJECTED_TOTAL_KEY),
      ...SCAN_REJECTION_REASON_KEYS.map(({ key }) => redis.get<number>(`analytics:scan_rejected_${key}_total`)),
    ])

    return {
      approvedCount: approvedCount ?? 0,
      rejectedCount: rejectedCount ?? 0,
      rejectionReasons: SCAN_REJECTION_REASON_KEYS.flatMap((entry, index) => {
        const count = reasonCounts[index] ?? 0
        return count > 0 ? [{ reason: entry.label, count }] : []
      }),
    }
  } catch (error) {
    console.warn('[analytics-metrics] Failed to read scan outcomes:', error)
    return { approvedCount: 0, rejectedCount: 0, rejectionReasons: [] }
  }
}

/**
 * Records one vision scan outcome (from `VisionService.analyzeScan`, the
 * flow the merchant app actually uses). `latencyMs` is the wall-clock time
 * of the Gemini round trip; `success` is true for any non-error outcome
 * (`blurry` / `unrecognized` / `identified` all count as a completed scan —
 * "success" here means the pipeline returned a verdict, not that the item
 * was approved).
 */
export async function recordVisionScan(params: { success: boolean; latencyMs: number }): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await Promise.all([
      redis.incr(VISION_SCANS_TOTAL_KEY),
      params.success ? redis.incr(VISION_SCANS_SUCCESS_KEY) : Promise.resolve(),
      redis.incrbyfloat(VISION_LATENCY_MS_TOTAL_KEY, params.latencyMs),
    ])
  } catch (error) {
    console.warn('[analytics-metrics] Failed to record vision scan:', error)
  }
}

/**
 * Reads the average scan latency and success rate from the cumulative
 * counters. Zero/no-scans-yet is reported as `{ avgLatencyMs: 0, successRate: 0 }`
 * rather than an error, since that is the true current state, not a missing
 * backend.
 */
export async function readVisionPerformance(): Promise<{ avgLatencyMs: number; successRate: number }> {
  const redis = getRedisClient()
  if (!redis) return { avgLatencyMs: 0, successRate: 0 }
  try {
    const [total, success, latencyTotal] = await Promise.all([
      redis.get<number>(VISION_SCANS_TOTAL_KEY),
      redis.get<number>(VISION_SCANS_SUCCESS_KEY),
      redis.get<number>(VISION_LATENCY_MS_TOTAL_KEY),
    ])
    const totalCount = total ?? 0
    if (totalCount === 0) return { avgLatencyMs: 0, successRate: 0 }
    return {
      avgLatencyMs: (latencyTotal ?? 0) / totalCount,
      successRate: (success ?? 0) / totalCount,
    }
  } catch (error) {
    console.warn('[analytics-metrics] Failed to read vision performance:', error)
    return { avgLatencyMs: 0, successRate: 0 }
  }
}
