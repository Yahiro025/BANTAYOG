import { Hono } from 'hono'
import { createServiceClient } from '../lib/supabase.js'
import { QrTokenService } from '../services/qr-token.service.js'
import { toBalanceViewTransactionDTO, type BalanceViewDTO } from '../dto/mappers.js'
import { JwtError, ValidationError, PersistenceError, errorToHttpStatus, errorToResponseBody } from '../lib/errors.js'
import type { Env } from '../types/env.js'

const balanceRoutes = new Hono<{ Bindings: Env }>()

// Maximum number of transaction history entries returned (Requirement 8.2).
const MAX_TRANSACTION_HISTORY = 50

// GET /api/balance/view?token=<qrToken>
// Read-only, PIN-less balance and transaction-history view reachable by
// scanning a beneficiary's QR pass. Authorized solely by the signed QR
// token (Requirement 8.3) — this route is intentionally PUBLIC and carries
// no `authMiddleware`/`requireRole`.
// Precedence of failure handling (per Requirement 8.6, 8.7, 8.8, checked in
// this order):
// 1. Invalid/expired QR token -> deny access, withhold ALL data, "invalid
// pass" message (8.6). No beneficiary is resolved at this stage.
// 2. Valid token but the encoded beneficiary/wallet cannot be resolved ->
// deny access, withhold data, distinct "cannot be matched" message
// (8.7).
// 3. Balance/history retrieval failure -> withhold partial data, distinct
// "temporarily unavailable" message (8.8).
// On success, returns the current balance plus up to 50 Transaction_Record
// entries, most-recent-first, scoped to that beneficiary only, with no
// mutating fields/controls in the response (Requirements 8.2, 8.4, 8.5).
// Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
balanceRoutes.get('/view', async (c) => {
  const token = c.req.query('token')

  // No token at all is treated the same as an invalid pass (Requirement
  // 8.6) — no beneficiary is resolved and all data is withheld.
  if (!token) {
    const error = new JwtError('No QR token provided', 'invalid')
    return c.json(errorToResponseBody(error), errorToHttpStatus(error))
  }

  // 1. Decode/verify the QR token (Requirement 8.6).
  const qrTokenService = new QrTokenService()
  const verifyResult = await qrTokenService.verifyToken(token)
  if (verifyResult.isErr()) {
    return c.json(
      { error: 'invalid_pass', message: 'This pass is invalid or has expired.' },
      errorToHttpStatus(verifyResult.error),
    )
  }
  const { beneficiaryId } = verifyResult.value

  const db = createServiceClient()

  // Check if the QR token is expired or revoked in the database
  const { data: qrPass } = await (db as any)
    .from('qr_passes')
    .select('expires_at, revoked')
    .eq('beneficiary_id', beneficiaryId)
    .maybeSingle()

  if (qrPass && qrPass.revoked) {
    return c.json({ error: 'invalid_pass', message: 'This pass has been revoked' }, 403)
  }

  if (qrPass && qrPass.expires_at && new Date(qrPass.expires_at) <= new Date()) {
    return c.json({ error: 'invalid_pass', message: 'This pass is invalid or has expired.' }, 401)
  }

  // 2. Resolve the single beneficiary encoded in the token (Requirement 8.7).
  let beneficiary: any
  try {
    const { data, error } = await (db as any)
      .from('beneficiaries')
      .select('id, credit_balance, child_name, eligibility_status')
      .eq('id', beneficiaryId)
      .single()

    if (error || !data) {
      const notMatched = new ValidationError('This pass could not be matched to a beneficiary.')
      return c.json(
        { error: 'not_matched', message: notMatched.message },
        404,
      )
    }

    if (data.eligibility_status === 'SUSPENDED' || data.eligibility_status === 'INELIGIBLE') {
      return c.json({ error: 'invalid_pass', message: 'This pass is invalid or has expired.' }, 401)
    }

    beneficiary = data
  } catch {
    const notMatched = new ValidationError('This pass could not be matched to a beneficiary.')
    return c.json(
      { error: 'not_matched', message: notMatched.message },
      404,
    )
  }

  // 3. Retrieve balance + transaction history, scoped to this beneficiary
  // only, ordered most-recent-first, capped at 50 (Requirements 8.2, 8.4).
  // Any retrieval failure withholds partial data (Requirement 8.8).
  try {
    const { data: transactions, error: txError } = await (db as any)
      .from('transactions')
      .select('total_amount, status, created_at')
      .eq('beneficiary_id', beneficiaryId)
      .order('created_at', { ascending: false })
      .limit(MAX_TRANSACTION_HISTORY)

    if (txError) {
      throw new PersistenceError(`Failed to load transaction history: ${txError.message}`, 'transactions')
    }

    const body: BalanceViewDTO = {
      beneficiaryName: beneficiary.child_name,
      balance: Number(beneficiary.credit_balance),
      transactions: (transactions ?? []).map(toBalanceViewTransactionDTO),
    }

    return c.json(body, 200)
  } catch (e) {
    console.error("Balance view error:", e);
    return c.json(
      { error: 'temporarily_unavailable', message: 'Balance information is temporarily unavailable. Please try again later.' },
      503,
    )
  }
})

export default balanceRoutes
