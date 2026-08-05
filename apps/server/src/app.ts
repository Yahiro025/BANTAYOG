/**
 * Hono app factory + middleware stack.
 *
 * Middleware order (per BANTAYOG_PROJECT_PLAN.md §9):
 *   1. CORS     — permissive for dev, locked for prod
 *   2. Logger   — structured pino request logging
 *   3. Auth     — verify Supabase JWT (skip for /health and public routes)
 *   4. RBAC     — role-based access control (applied per-route-group)
 *   5. RateLimit — Upstash sliding window (applied per-route-group)
 *
 * BE1 owns this file.
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestLogger } from './middleware/request-logger.js'
import { authMiddleware } from './middleware/auth.js'
import { requireRole } from './middleware/rbac.js'
import { rateLimit } from './middleware/rate-limit.js'
import type { Env } from './types/env.js'

// ---------------------------------------------------------------------------
// App creation
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>()
const defaultCorsOrigin = 'http://localhost:3000'
const corsOrigins = (process.env.CORS_ORIGIN ?? defaultCorsOrigin)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

// --- Global middleware ---

// CORS: allow configured web origins and the Capacitor Android origin.
app.use(
  '*',
  cors({
    origin: corsOrigins,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
)

// Logger: structured pino request logging
app.use('*', requestLogger)

// Global rate limit: 100 requests per minute per IP
app.use('*', rateLimit('global', 100, 60))

// Specific rate limits on sensitive endpoints
app.use('/api/auth/login', rateLimit('login', 5, 60))
app.use('/api/auth/merchant-login', rateLimit('merchant-login', 5, 60))
app.use('/api/auth/verify-pin', rateLimit('pin', 3, 60))
app.use('/api/vision/classify', rateLimit('gemini', 10, 60))
app.use('/api/vision/analyze-nutrition', rateLimit('gemini', 10, 60))

// --- Health check (public, no auth required) ---
/**
 * GET /health
 *
 * Returns 200 with a simple status payload. Used by:
 * - Vercel deployment health checks
 * - P1 DoD: `curl localhost:3001/health` returns 200
 * - Docker/load-balancer liveness probes
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'bantayog-server',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  })
})

// --- Middleware stack (scaffolded, wired per-route-group in P2+) ---
// The following middleware factories are defined and ready for use:
//   - authMiddleware  (src/middleware/auth.ts)    — verifies Supabase JWT
//   - requireRole     (src/middleware/rbac.ts)     — role-based access control
//   - rateLimit       (src/middleware/rate-limit.ts) — Upstash sliding window
// They are applied per-route-group, not globally, because /health must remain public.
// Example wiring in P2:
//   app.post('/api/beneficiaries', authMiddleware, requireRole('admin'), handler)

// --- Route groups ---
import authRoutes from './routes/auth.js'
import beneficiaryRoutes from './routes/beneficiaries.js'
import merchantRoutes from './routes/merchants.js'
import chainRoutes from './routes/chain.js'
import productRoutes from './routes/products.js'
import visionRoutes from './routes/vision.js'
import transactionRoutes from './routes/transactions.js'
import balanceRoutes from './routes/balance.js'
import merchantSelfRoutes from './routes/merchant-self.js'
import analyticsRoutes from './routes/analytics.js'

// Auth routes: mostly public (login, merchant-login); logout protected inside authRoutes
app.route('/api/auth', authRoutes)

// Balance view: intentionally PUBLIC (like /health) — access is authorized
// solely by the signed QR token itself (Requirement 8.3), not by a session,
// so it deliberately carries no authMiddleware/requireRole.
app.route('/api/balance', balanceRoutes)

// Merchant self-profile routes (merchant-only, authenticated)
// MUST be registered before /api/merchants/* admin wildcard to avoid
// the admin-only middleware intercepting /api/merchants/me requests.
app.use('/api/merchants/me', authMiddleware, requireRole('merchant'))
app.use('/api/merchants/me/*', authMiddleware, requireRole('merchant'))
app.route('/api/merchants/me', merchantSelfRoutes)

// Admin-only routes
app.use('/api/beneficiaries', authMiddleware, requireRole('admin'))
app.use('/api/beneficiaries/*', authMiddleware, requireRole('admin'))
app.route('/api/beneficiaries', beneficiaryRoutes)

app.use('/api/merchants', authMiddleware, requireRole('admin'))
app.use('/api/merchants/*', authMiddleware, requireRole('admin'))
app.route('/api/merchants', merchantRoutes)

// Admin-only routes: `/admin/analytics` tab data source
app.use('/api/analytics', authMiddleware, requireRole('admin'))
app.use('/api/analytics/*', authMiddleware, requireRole('admin'))
app.route('/api/analytics', analyticsRoutes)

// Admin + Merchant routes
app.use('/api/chain', authMiddleware, requireRole('admin', 'merchant'))
app.use('/api/chain/*', authMiddleware, requireRole('admin', 'merchant'))
app.route('/api/chain', chainRoutes)

app.use('/api/products', authMiddleware, requireRole('admin', 'merchant'))
app.use('/api/products/*', authMiddleware, requireRole('admin', 'merchant'))
app.route('/api/products', productRoutes)

// Merchant-only routes
app.use('/api/vision', authMiddleware, requireRole('merchant'))
app.use('/api/vision/*', authMiddleware, requireRole('merchant'))
app.route('/api/vision', visionRoutes)

// Admin + Merchant routes
app.use('/api/transactions', authMiddleware, requireRole('admin', 'merchant'))
app.use('/api/transactions/*', authMiddleware, requireRole('admin', 'merchant'))
app.route('/api/transactions', transactionRoutes)

// Cron routes (auth-bypass; uses custom Bearer CRON_SECRET auth internally)
import cronRoutes from './routes/cron/index.js'
app.route('/api/cron', cronRoutes)


// --- 404 fallback ---
app.notFound((c) => {
  return c.json({ error: 'not_found', message: 'Route not found' }, 404)
})

// --- Global error handler ---
app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json(
    {
      error: 'internal_error',
      message: 'An unexpected error occurred',
    },
    500,
  )
})

export { app }
