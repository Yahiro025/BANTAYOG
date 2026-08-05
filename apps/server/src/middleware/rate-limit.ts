import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { createMiddleware } from 'hono/factory'
import type { Env } from '../types/env.js'

const limiters = new Map<string, Ratelimit>()

function getLimiter(name: string, limit: number, windowSeconds: number, url: string, token: string): Ratelimit {
  const key = `${name}:${limit}:${windowSeconds}`
  if (!limiters.has(key)) {
    const redis = new Redis({
      url,
      token,
    })
    limiters.set(
      key,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowSeconds}s`),
        prefix: `@upstash/ratelimit:${name}`,
      })
    )
  }
  return limiters.get(key)!
}

// Creates a rate-limit middleware for a specific limiter.
// @param limiterName - identifier for the limiter (e.g. 'pin', 'gemini', 'login')
// @param limit - max requests per window
// @param windowSeconds - window size in seconds
export function rateLimit(limiterName: string, limit: number, windowSeconds: number) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || c.env?.UPSTASH_REDIS_REST_URL
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || c.env?.UPSTASH_REDIS_REST_TOKEN

    if (!upstashUrl || !upstashToken || upstashUrl.includes('...')) {
      // Graceful pass through if Upstash is not configured.
      await next()
      return
    }

    try {
      const limiter = getLimiter(limiterName, limit, windowSeconds, upstashUrl, upstashToken)
      let identifier = ''

      if (limiterName === 'pin') {
        try {
          const cloned = c.req.raw.clone()
          const body = (await cloned.json()) as { beneficiaryId?: string }
          identifier = body?.beneficiaryId || ''
        } catch {
          // ignore parsing error
        }
      } else if (limiterName === 'gemini') {
        const user = (c.get as any)('user')
        identifier = user?.id || ''
      }

      if (!identifier) {
        identifier = c.req.header('x-forwarded-for') || 'anonymous'
      }

      const { success, reset } = await limiter.limit(`${limiterName}:${identifier}`)

      if (!success) {
        c.header('Retry-After', Math.ceil((reset - Date.now()) / 1000).toString())
        return c.json(
          {
            error: 'rateLimit',
            message: 'Too many requests'
          },
          429
        )
      }
    } catch (err) {
      console.warn('Upstash rate limiting error, passing through:', err)
    }

    return await next()
  })
}
