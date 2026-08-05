// Upstash Redis client factory.
// BE1 owns this file. Provides a Redis client for rate-limiting and caching.
// Full configuration (PIN brute-force, Gemini RPM) is wired up in P5 (T-5.3).
// For P1, this is a stub that returns null if Upstash is not configured,
// allowing the rate-limit middleware to pass through.
import { Redis } from '@upstash/redis'

// Creates an Upstash Redis client from environment variables.
// Returns null if Upstash env vars are not set (P1 pass-through mode).
export function createRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    return null
  }

  return new Redis({ url, token })
}

let _redisClient: Redis | null | undefined

// Returns a lazily-initialized singleton Redis client.
// Returns null if Upstash is not configured.
export function getRedisClient(): Redis | null {
  if (_redisClient === undefined) {
    _redisClient = createRedisClient()
  }
  return _redisClient
}
