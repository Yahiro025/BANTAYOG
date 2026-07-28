import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { app as App } from './app.js'

let app: typeof App
const previousCorsOrigin = process.env.CORS_ORIGIN

beforeAll(async () => {
  process.env.CORS_ORIGIN = 'http://localhost:3000,https://localhost'
  ;({ app } = await import('./app.js'))
})

afterAll(() => {
  if (previousCorsOrigin === undefined) {
    delete process.env.CORS_ORIGIN
  } else {
    process.env.CORS_ORIGIN = previousCorsOrigin
  }
})

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.service).toBe('bantayog-server')
    expect(body.version).toBe('0.1.0')
    expect(body.timestamp).toBeDefined()
  })

  it('returns Content-Type application/json', async () => {
    const res = await app.request('/health')
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await app.request('/api/nonexistent')
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error).toBe('not_found')
  })
})

describe('CORS middleware', () => {
  it('allows an origin in the configured comma-separated allowlist', async () => {
    const res = await app.request('/health', {
      headers: { Origin: 'https://localhost' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost')
  })

  it('does not allow an unknown origin', async () => {
    const res = await app.request('/health', {
      headers: { Origin: 'https://unknown.example.test' },
    })

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows an Authorization preflight for an allowed origin', async () => {
    const res = await app.request('/api/auth/merchant-login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost')
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization')
  })
})
