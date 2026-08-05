import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { createServiceClient } from '../lib/supabase.js'
import { PinService } from '../services/pin.service.js'
import { BeneficiaryService } from '../services/beneficiary.service.js'
import { QrTokenService } from '../services/qr-token.service.js'
import { authMiddleware } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { errorToHttpStatus, errorToResponseBody } from '../lib/errors.js'
import type { Env } from '../types/env.js'

const authRoutes = new Hono<{ Bindings: Env }>()
const pinService = new PinService()

// Validation Schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
})

const merchantLoginSchema = z.object({
  mobileNumberE164: z.string().min(1),
  password: z.string().min(6)
})

const verifyPinSchema = z.object({
  beneficiaryId: z.string().uuid(),
  pin: z.string().length(6)
})

// POST /api/auth/login
// Admin Login via Supabase Auth
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json')
  const db = createServiceClient()

  const { data, error } = await db.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    return c.json({ error: 'unauthorized', message: error.message }, 401)
  }

  // Check if role is admin
  if (data.user?.app_metadata?.role !== 'admin') {
    // Attempt signout since user is not admin
    await db.auth.signOut()
    return c.json({ error: 'forbidden', message: 'User is not an LGU admin' }, 403)
  }

  return c.json({
    user: {
      id: data.user.id,
      email: data.user.email,
      role: 'admin'
    },
    session: {
      accessToken: data.session?.access_token,
      expiresAt: data.session?.expires_at
    }
  })
})

// POST /api/auth/merchant-login
// Merchant Login via Supabase Auth (email derived from mobile number)
authRoutes.post('/merchant-login', zValidator('json', merchantLoginSchema), async (c) => {
  const { mobileNumberE164, password } = c.req.valid('json')
  const db = createServiceClient()

  const email = `${mobileNumberE164.replace('+', '')}@merchant.bantayog.local`;

  const { data, error } = await db.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    return c.json({ error: 'unauthorized', message: error.message }, 401)
  }

  if (!data.user?.id) {
    return c.json({ error: 'unauthorized', message: 'User session not established' }, 401)
  }

  // Fetch merchant profile
  const { data: merchant, error: dbError } = await (db as any)
    .from('merchants')
    .select('*')
    .eq('auth_user_id', data.user.id)
    .single()

  if (dbError || !merchant) {
    await db.auth.signOut()
    return c.json({ error: 'forbidden', message: 'Merchant profile not found' }, 403)
  }

  if (merchant.status === 'SUSPENDED') {
    await db.auth.signOut()
    return c.json({ error: 'forbidden', message: 'Your merchant account has been suspended. Please contact the administrator.' }, 403)
  }

  return c.json({
    user: {
      id: data.user.id,
      email: data.user.email,
      role: 'merchant',
      merchantId: merchant.id,
      storeName: merchant.store_name
    },
    session: {
      accessToken: data.session?.access_token,
      refreshToken: data.session?.refresh_token,
      expiresAt: data.session?.expires_at
    }
  })
})

const merchantRefreshSchema = z.object({
  refreshToken: z.string().min(1)
})

// POST /api/auth/merchant-refresh
// Refresh merchant session using refresh token
authRoutes.post('/merchant-refresh', zValidator('json', merchantRefreshSchema), async (c) => {
  const { refreshToken } = c.req.valid('json')
  const db = createServiceClient()

  const { data, error } = await db.auth.refreshSession({
    refresh_token: refreshToken
  })

  if (error || !data.session) {
    return c.json({ error: 'unauthorized', message: error?.message || 'Failed to refresh session' }, 401)
  }

  return c.json({
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at
    }
  })
})

// POST /api/auth/verify-pin
// PIN verification endpoint during checkout
authRoutes.post('/verify-pin', zValidator('json', verifyPinSchema), async (c) => {
  const { beneficiaryId, pin } = c.req.valid('json')
  const db = createServiceClient()

  // Fetch beneficiary pin hash from database
  const { data: beneficiary, error } = await (db as any)
    .from('beneficiaries')
    .select('*')
    .eq('id', beneficiaryId)
    .single()

  if (error || !beneficiary || !beneficiary.pin_hash_argon2id) {
    return c.json({ error: 'not_found', message: 'Beneficiary PIN record not found' }, 404)
  }

  const verifyResult = await pinService.verifyPin(pin, beneficiary.pin_hash_argon2id)

  return verifyResult.match(
    (isValid) => {
      if (!isValid) {
        return c.json({ error: 'unauthorized', message: 'Incorrect PIN' }, 401)
      }
      return c.json({ status: 'success', verified: true })
    },
    (errVal) => c.json(errorToResponseBody(errVal), errorToHttpStatus(errVal))
  )
})

const verifyQrSchema = z.object({
  token: z.string().min(1)
})

// POST /api/auth/verify-qr
// Verifies the beneficiary QR code, performs live tier re-evaluation, and returns details.
authRoutes.post('/verify-qr', zValidator('json', verifyQrSchema), async (c) => {
  const { token } = c.req.valid('json')
  const qrTokenService = new QrTokenService()
  
  const payloadResult = await qrTokenService.verifyToken(token)
  if (payloadResult.isErr()) {
    return c.json(errorToResponseBody(payloadResult.error), errorToHttpStatus(payloadResult.error))
  }
  const payload = payloadResult.value

  const db = createServiceClient()

  // Check if the QR token is expired or revoked in the database
  const { data: qrPass } = await (db as any)
    .from('qr_passes')
    .select('expires_at, revoked')
    .eq('beneficiary_id', payload.beneficiaryId)
    .maybeSingle()

  if (qrPass && qrPass.revoked) {
    return c.json({ error: 'unauthorized', message: 'This pass has been revoked.' }, 401)
  }

  if (qrPass && qrPass.expires_at && new Date(qrPass.expires_at) <= new Date()) {
    return c.json({ error: 'unauthorized', message: 'This pass is invalid or has expired.' }, 401)
  }

  const beneficiaryService = new BeneficiaryService(db)

  const result = await beneficiaryService.verifyAndReevaluateTier(payload.beneficiaryId)
  return result.match(
    (res) => {
      if (res.beneficiary.eligibility_status === 'SUSPENDED' || res.beneficiary.eligibility_status === 'INELIGIBLE') {
        return c.json({ error: 'unauthorized', message: 'This pass is invalid or has expired.' }, 401)
      }
      return c.json({
        status: 'success',
        beneficiary: res.beneficiary,
        currentTier: res.tier
      })
    },
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// POST /api/auth/logout
// Signs out the current Supabase session.
authRoutes.post('/logout', authMiddleware, requireRole('admin', 'merchant'), async (c) => {
  const db = createServiceClient()
  const { error } = await db.auth.signOut({ scope: 'local' })

  if (error) {
    return c.json({ error: 'logout_failed', message: error.message }, 500)
  }

  return c.json({ success: true, message: 'Signed out successfully' })
})

export default authRoutes

