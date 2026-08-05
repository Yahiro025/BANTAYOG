import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { createClient } from '@supabase/supabase-js'
import { CreateMerchantDto } from '@bantayog/schema'
import { createServiceClient } from '../lib/supabase.js'
import { MerchantService } from '../services/merchant.service.js'
import { type AuthContext } from '../middleware/auth.js'
import { toMerchantDTO } from '../dto/mappers.js'
import { errorToHttpStatus, errorToResponseBody } from '../lib/errors.js'
import type { Env } from '../types/env.js'

const merchantRoutes = new Hono<{ Bindings: Env; Variables: AuthContext }>()

// Extend CreateMerchantDto schema to require password for registration
const registerMerchantSchema = CreateMerchantDto.extend({
  password: z.string().min(6)
})

// POST /api/merchants/register
// Onboards a new merchant and registers them in Supabase Auth & DB
merchantRoutes.post('/register', zValidator('json', registerMerchantSchema), async (c) => {
  const dto = c.req.valid('json')
  const db = createServiceClient()
  const service = new MerchantService(db)

  // Req 14.3, 14.5: Any supplied walletAddress is ignored; merchant is created with wallet_address = null
  const result = await service.register({
    storeName: dto.storeName,
    ownerName: dto.ownerName,
    mobileNumberE164: dto.mobileNumberE164,
    password: dto.password
  })

  return result.match(
    (record) => c.json(toMerchantDTO(record), 201),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// GET /api/merchants
// Lists all registered merchants (admin view)
merchantRoutes.get('/', async (c) => {
  const db = createServiceClient()
  const service = new MerchantService(db)

  const page = Number(c.req.query('page') || '1')
  const limit = Number(c.req.query('limit') || '20')

  const result = await service.list(page, limit)

  return result.match(
    (res) => c.json({
      data: res.data.map(toMerchantDTO),
      count: res.count
    }),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// PATCH /api/merchants/:id/approve
// Approves a merchant (admin only).
merchantRoutes.patch('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const db = createServiceClient()
  const service = new MerchantService(db)

  const result = await service.approve(id)

  return result.match(
    (record) => c.json(toMerchantDTO(record)),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// PATCH /api/merchants/:id/status
// Updates a merchant's status (admin only).
merchantRoutes.patch('/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const status = body.status
  const password = body.password

  if (!status || !['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'].includes(status)) {
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
  const service = new MerchantService(db)

  const result = await service.updateStatus(id, status)

  return result.match(
    (record) => c.json(toMerchantDTO(record)),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

export default merchantRoutes

