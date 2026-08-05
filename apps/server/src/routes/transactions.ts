import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { createServiceClient } from '../lib/supabase.js'
import { TransactionService } from '../services/transaction.service.js'
import { QrTokenService } from '../services/qr-token.service.js'
import { PinService } from '../services/pin.service.js'
import { authMiddleware, type AuthContext } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { toTransactionDTO, toAnalyticsTransactionSummaryDTO } from '../dto/mappers.js'
import { errorToHttpStatus, errorToResponseBody } from '../lib/errors.js'
import type { Env } from '../types/env.js'

const transactionRoutes = new Hono<{ Bindings: Env; Variables: AuthContext }>()

const NutritionCategorySchema = z.enum([
  'FRUITS',
  'VEGETABLES',
  'MEATS',
  'BEVERAGES',
  'DAIRY',
  'GRAINS',
  'CANNED_GOODS',
  'SNACKS',
  'OTHER',
])

const TransactionItemSchema = z.object({
  category: NutritionCategorySchema,
  name: z.string().min(1).max(200),
  quantity: z.number().positive(),
  unitPricePhp: z.number().nonnegative(),
  creditCost: z.number().nonnegative(),
  imageUrl: z.string().optional(),
})

const createTransactionSchema = z.object({
  qrToken: z.string().min(1),
  pin: z.string().length(6),
  items: z.array(TransactionItemSchema).min(1),
  idempotencyKey: z.string().uuid(),
  photoStoragePath: z.string().optional()
})

// Apply authentication to all transaction routes
transactionRoutes.use('*', authMiddleware)

/**
 * POST /api/transactions
 * Submit a new redemption transaction.
 * Restrained to merchants.
 */
transactionRoutes.post(
  '/',
  requireRole('merchant'),
  zValidator('json', createTransactionSchema),
  async (c) => {
    const { qrToken, pin, items, idempotencyKey } = c.req.valid('json')
    const user = c.get('user')

    if (!user || user.role !== 'merchant') {
      return c.json({ error: 'unauthorized', message: 'User session not established or not a merchant' }, 401)
    }

    const db = createServiceClient()

    // 1. Fetch merchant details using auth_user_id
    const { data: merchant, error: merchantErr } = await (db as any)
      .from('merchants')
      .select('*')
      .eq('auth_user_id', user.id)
      .single()

    if (merchantErr || !merchant) {
      return c.json({ error: 'forbidden', message: 'Merchant profile not found' }, 403)
    }

    if (merchant.status !== 'APPROVED') {
      return c.json({ error: 'forbidden', message: 'Merchant is not approved to perform transactions' }, 403)
    }

    // 2. Decode and verify the QR token
    const qrTokenService = new QrTokenService()
    const verifyTokenResult = await qrTokenService.verifyToken(qrToken)
    if (verifyTokenResult.isErr()) {
      return c.json(errorToResponseBody(verifyTokenResult.error), errorToHttpStatus(verifyTokenResult.error))
    }
    const decodedToken = verifyTokenResult.value

    const { beneficiaryId } = decodedToken

    // Check if the QR token is expired in the database (status suspends it)
    const { data: qrPass } = await (db as any)
      .from('qr_passes')
      .select('expires_at')
      .eq('beneficiary_id', beneficiaryId)
      .maybeSingle()

    if (qrPass && qrPass.expires_at && new Date(qrPass.expires_at) <= new Date()) {
      return c.json({ error: 'unauthorized', message: 'This pass is invalid or has expired.' }, 401)
    }

    // 3. Fetch beneficiary and verify PIN
    const { data: beneficiary, error: beneficiaryErr } = await (db as any)
      .from('beneficiaries')
      .select('*')
      .eq('id', beneficiaryId)
      .single()

    if (beneficiaryErr || !beneficiary) {
      return c.json({ error: 'not_found', message: 'Beneficiary not found' }, 404)
    }

    if (beneficiary.eligibility_status === 'SUSPENDED' || beneficiary.eligibility_status === 'INELIGIBLE') {
      return c.json({ error: 'unauthorized', message: 'This beneficiary is currently suspended or ineligible.' }, 401)
    }

    const pinService = new PinService()
    // Requirements 7.3, 7.4, 7.5: lockout check happens inside
    // verifyPinWithLockout BEFORE the PIN is attempted, and any error
    // (including RateLimitError on lockout) is already mapped correctly by
    // errorToHttpStatus (rateLimit -> 429).
    const verifyResult = await pinService.verifyPinWithLockout(beneficiaryId, pin, beneficiary.pin_hash_argon2id || '')
    if (verifyResult.isErr()) {
      return c.json(errorToResponseBody(verifyResult.error), errorToHttpStatus(verifyResult.error))
    }
    const isPinValid = verifyResult.value
    if (!isPinValid) {
      return c.json({ error: 'unauthorized', message: 'Incorrect guardian PIN' }, 401)
    }

    // 4. Calculate total credit cost and verify amount/credit balance
    const totalCreditDeducted = items.reduce((sum, item) => sum + Number(item.creditCost), 0)

    // Requirement 7.9: reject non-positive purchase amounts before any balance check.
    if (totalCreditDeducted <= 0) {
      return c.json({ error: 'validation', message: 'Purchase amount must be greater than zero' }, 400)
    }

    const currentBalance = Number(beneficiary.credit_balance)
    // Requirement 7.7: reject over-balance purchases without mutating the balance.
    if (currentBalance < totalCreditDeducted) {
      return c.json({ error: 'bad_request', message: 'Insufficient beneficiary credit balance' }, 400)
    }

    // 5. Call the settle_sale Postgres RPC to atomically deduct beneficiary credit,
    // credit merchant wallet_balance, and insert the transaction row with status = CONFIRMED.
    const { data: txId, error: rpcError } = await (db as any).rpc('settle_sale', {
      p_beneficiary_id: beneficiaryId,
      p_merchant_id: merchant.id,
      p_amount: totalCreditDeducted,
      p_items: items,
      p_transaction_id: idempotencyKey
    })

    if (rpcError || !txId) {
      return c.json({ error: 'bad_request', message: rpcError?.message || 'Transaction settlement failed' }, 400)
    }

    const confirmedAt = new Date().toISOString()
    const txRow = {
      id: idempotencyKey,
      beneficiary_id: beneficiaryId,
      merchant_id: merchant.id,
      item_list_jsonb: items,
      total_credit_deducted: totalCreditDeducted,
      stablecoin_amount_wei: '0',
      onchain_tx_hash: null,
      idempotency_key: idempotencyKey,
      status: 'CONFIRMED',
      created_at: confirmedAt,
      confirmed_at: confirmedAt
    }

    const remainingBalance = currentBalance - totalCreditDeducted

    return c.json({ ...toTransactionDTO(txRow), remainingBalance }, 201)
  }
)

/**
 * GET /api/transactions
 * Retrieve transaction history. Accessible to admin and merchant.
 */
transactionRoutes.get(
  '/',
  requireRole('admin', 'merchant'),
  async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthorized', message: 'Authentication required' }, 401)

    const db = createServiceClient()
    const transactionService = new TransactionService(db)

    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '20')
    const status = c.req.query('status') as any
    // `?summary=1` returns the privacy-safe analytics projection instead of the
    // default DTO, which embeds beneficiary and merchant identity fields.
    const summary = c.req.query('summary') === '1'

    let merchantId = c.req.query('merchantId')
    const beneficiaryId = c.req.query('beneficiaryId')

    // If merchant role, restrict results to their own transactions
    if (user.role === 'merchant') {
      const { data: merchant, error: mErr } = await (db as any)
        .from('merchants')
        .select('id')
        .eq('auth_user_id', user.id)
        .single()

      if (mErr || !merchant) {
        return c.json({ error: 'forbidden', message: 'Merchant profile not found' }, 403)
      }
      merchantId = merchant.id
    }

    const result = await transactionService.listTransactions({
      merchantId,
      beneficiaryId,
      status,
      page,
      limit,
      summary
    })

    return result.match(
      (res) => c.json({
        data: summary
          ? res.data.map(toAnalyticsTransactionSummaryDTO)
          : res.data.map(toTransactionDTO),
        count: res.count
      }),
      (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
    )
  }
)

/**
 * GET /api/transactions/:id
 * Retrieve detail of a single transaction.
 */
transactionRoutes.get(
  '/:id',
  requireRole('admin', 'merchant'),
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthorized', message: 'Authentication required' }, 401)

    const db = createServiceClient()
    const transactionService = new TransactionService(db)

    const txResult = await transactionService.getTransaction(id)

    return txResult.match(
      async (tx) => {
        // If merchant role, check that they own the transaction
        if (user.role === 'merchant') {
          const { data: merchant, error: mErr } = await (db as any)
            .from('merchants')
            .select('id')
            .eq('auth_user_id', user.id)
            .single()

          if (mErr || !merchant || tx.merchant_id !== merchant.id) {
            return c.json({ error: 'forbidden', message: 'You do not have access to this transaction' }, 403)
          }
        }

        return c.json(toTransactionDTO(tx))
      },
      (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
    )
  }
)

export default transactionRoutes

