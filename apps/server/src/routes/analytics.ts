/**
 * Analytics routes — `/admin/analytics` tab data source.
 *
 * Admin-only (wired in `app.ts` alongside `/api/beneficiaries` and
 * `/api/merchants`). Every response here is a display-only aggregate; no
 * route in this file ever mutates `beneficiaries`, `merchants`, or
 * `transactions`.
 *
 * Contracts: `packages/schema/src/analytics.ts` (imported by `apps/web` as
 * `@bantayog/schema/analytics`).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { DpaExportRequestDto, DpaExportCsvHeaders } from '@bantayog/schema/analytics'
import { createServiceClient } from '../lib/supabase.js'
import { AnalyticsService } from '../services/analytics.service.js'
import { errorToHttpStatus, errorToResponseBody } from '../lib/errors.js'
import type { Env } from '../types/env.js'
import type { AuthContext } from '../middleware/auth.js'

const analyticsRoutes = new Hono<{ Bindings: Env; Variables: AuthContext }>()

/**
 * BANTAYOG's schema has no `district` column on `beneficiaries` (verified
 * against every migration in `supabase/migrations/`), so the DPA export
 * groups everything under one configured LGU label instead of inventing a
 * per-row district. Matches the label already shown by `StatusBar` /
 * `QrPassModal` on the web app.
 */
const DEFAULT_DISTRICT_LABEL = 'Metro Manila City - District 2 (Municipal Nutrition Office)'

function parseDays(raw: string | undefined): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 30
  return Math.min(Math.floor(parsed), 3650)
}

/**
 * GET /api/analytics/top-products?days=<n>
 */
analyticsRoutes.get('/top-products', async (c) => {
  const days = parseDays(c.req.query('days'))
  const db = createServiceClient()
  const service = new AnalyticsService(db)

  const result = await service.getTopProducts(days)

  return result.match(
    (rows) => c.json(rows),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error)),
  )
})

/**
 * GET /api/analytics/scan-outcomes
 */
analyticsRoutes.get('/scan-outcomes', async (c) => {
  const db = createServiceClient()
  const service = new AnalyticsService(db)

  const result = await service.getScanOutcomes()

  return result.match(
    (outcomes) => c.json(outcomes),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error)),
  )
})

/**
 * GET /api/analytics/tier-spend
 */
analyticsRoutes.get('/tier-spend', async (c) => {
  const db = createServiceClient()
  const service = new AnalyticsService(db)

  const result = await service.getTierSpend()

  return result.match(
    (spend) => c.json(spend),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error)),
  )
})

/**
 * GET /api/analytics/vision-performance
 */
analyticsRoutes.get('/vision-performance', async (c) => {
  const db = createServiceClient()
  const service = new AnalyticsService(db)

  const result = await service.getVisionPerformance()

  return result.match(
    (performance) => c.json(performance),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error)),
  )
})

/**
 * GET /api/analytics/security-events
 */
analyticsRoutes.get('/security-events', async (c) => {
  const db = createServiceClient()
  const service = new AnalyticsService(db)

  const result = await service.getSecurityEvents()

  return result.match(
    (events) => c.json(events),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error)),
  )
})

/**
 * POST /api/analytics/dpa-export
 *
 * District-level aggregates only. The client (`DPAExportModal`) refuses any
 * JSON payload or CSV header outside `DpaExportRowDto`/`DpaExportCsvHeaders`,
 * so this handler never adds a field beyond those four.
 */
analyticsRoutes.post('/dpa-export', zValidator('json', DpaExportRequestDto), async (c) => {
  const { format, days } = c.req.valid('json')
  const db = createServiceClient()
  const service = new AnalyticsService(db)

  const districtLabel = process.env.LGU_DISTRICT_LABEL || DEFAULT_DISTRICT_LABEL

  const result = await service.getDpaExportRows(days, districtLabel)

  return result.match(
    (rows) => {
      if (format === 'json') {
        return c.json({ rows })
      }

      const csvLines = [
        DpaExportCsvHeaders.join(','),
        ...rows.map((row) =>
          [
            `"${row.district.replace(/"/g, '""')}"`,
            row.beneficiaryCount,
            row.transactionCount,
            row.totalCreditDeducted.toFixed(2),
          ].join(','),
        ),
      ]

      c.header('Content-Type', 'text/csv')
      c.header('Content-Disposition', `attachment; filename="bantayog-anonymised-consumption-${days}d.csv"`)
      return c.body(csvLines.join('\n'))
    },
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error)),
  )
})

export default analyticsRoutes
