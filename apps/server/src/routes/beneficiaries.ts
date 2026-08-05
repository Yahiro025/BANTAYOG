import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { createClient } from '@supabase/supabase-js'
import { CreateBeneficiaryDto } from '@bantayog/schema'
import { createServiceClient } from '../lib/supabase.js'
import { BeneficiaryService } from '../services/beneficiary.service.js'
import { type AuthContext } from '../middleware/auth.js'
import { toBeneficiaryDTO } from '../dto/mappers.js'
import { errorToHttpStatus, errorToResponseBody } from '../lib/errors.js'
import type { Env } from '../types/env.js'

const beneficiaryRoutes = new Hono<{ Bindings: Env; Variables: AuthContext }>()

// POST /api/beneficiaries/register
// Onboard a new beneficiary and generate QR Voucher/Pass
beneficiaryRoutes.post('/register', zValidator('json', CreateBeneficiaryDto, (result, c) => {
  if (!result.success) {
    const errorMsg = result.error?.issues
      ? result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      : (result.error?.message ?? 'Invalid request body');
    return c.json({
      error: 'validation_failed',
      message: errorMsg
    }, 400)
  }
  return undefined
}), async (c) => {
  const dto = c.req.valid('json')
  const db = createServiceClient()
  const service = new BeneficiaryService(db)

  const result = await service.register({
    guardianName: dto.guardianName,
    guardianMobileHash: dto.guardianMobileHash,
    childName: dto.childName,
    childAgeMonths: dto.childAgeMonths,
    monthlyIncomePhp: dto.monthlyIncomePhp,
    gpsLat: dto.gpsLat,
    gpsLng: dto.gpsLng,
    pin: dto.pin
  })

  return result.match(
    (res) => {
      const tierLabel = res.tier === 1 ? "TIER_1_CRITICAL" : "TIER_2_STANDARD";
      const alert_banner = res.tier === 1
        ? "Critical 1,000-Day Window: Beneficiary placed in Tier 1. Core nutritional subsidies allocated."
        : "Standard Intervention: Beneficiary placed in Tier 2 (Child is over 2 years old). Standard subsidy allocated.";

      return c.json({
        beneficiary: toBeneficiaryDTO({ ...res.beneficiary, tier: res.tier }),
        qrToken: res.qrToken,
        cardSerial: res.cardSerial,
        tier: tierLabel,
        alert_banner
      }, 201);
    },
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// GET /api/beneficiaries
// Fetch paginated active beneficiaries directory
beneficiaryRoutes.get('/', async (c) => {
  const db = createServiceClient()
  const service = new BeneficiaryService(db)

  const page = Number(c.req.query('page') || '1')
  const limit = Number(c.req.query('limit') || '20')

  const result = await service.list(page, limit)

  return result.match(
    (res) => c.json({
      data: res.data.map(toBeneficiaryDTO),
      count: res.count
    }),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// PATCH /api/beneficiaries/:id/credits
// Triggers the one-time tier-based PHPC allocation for a beneficiary
// (5,000 PHPC for Tier 1, 3,500 PHPC for Tier 2). The request body is
// ignored - the allocation amount is derived from the beneficiary's tier,
// not caller-supplied. Rejects duplicate allocations, insufficient
// treasury balance, invalid tier classifications, or on-chain failures.
beneficiaryRoutes.patch('/:id/credits', async (c) => {
  const id = c.req.param('id')
  const db = createServiceClient()
  const service = new BeneficiaryService(db)

  const result = await service.allocateTierCredits(id)
  return result.match(
    (res) => c.json({
      beneficiary: toBeneficiaryDTO(res.beneficiary),
      amount: res.amount,
      txHash: res.txHash
    }),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// GET /api/beneficiaries/metrics
// Dashboard aggregates: total beneficiaries, critical units, allocated PHPC, verified merchants.
beneficiaryRoutes.get('/metrics', async (c) => {
  const db = createServiceClient()
  const service = new BeneficiaryService(db)

  const result = await service.getMetrics()

  return result.match(
    (metrics) => c.json(metrics),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// PATCH /api/beneficiaries/:id/status
// Updates eligibility status of a beneficiary (admin only).
beneficiaryRoutes.patch('/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const status = body.status
  const password = body.password

  if (!status || !['PENDING', 'ELIGIBLE', 'INELIGIBLE', 'SUSPENDED'].includes(status)) {
    return c.json({ error: 'validation_failed', message: 'Invalid status value' }, 400)
  }

  if (!password) {
    return c.json({ error: 'forbidden', message: 'Admin password is required to change status' }, 403)
  }

  const adminUser = c.get('user')
  if (!adminUser || !adminUser.email) {
    return c.json({ error: 'forbidden', message: 'Admin session is required' }, 403)
  }

  // Verify the admin password
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return c.json({ error: 'internal_error', message: 'Supabase configuration is missing on server' }, 500)
  }

  const tempSupabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { error: authError } = await tempSupabase.auth.signInWithPassword({
    email: adminUser.email,
    password
  })

  if (authError) {
    return c.json({ error: 'forbidden', message: 'Incorrect admin password' }, 403)
  }

  const db = createServiceClient()
  const service = new BeneficiaryService(db)

  const result = await service.updateStatus(id, status)

  return result.match(
    (record) => c.json(toBeneficiaryDTO(record)),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

export default beneficiaryRoutes

