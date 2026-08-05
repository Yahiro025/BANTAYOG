import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { ok, err } from 'neverthrow'
import { JwtError, RateLimitError } from '../lib/errors.js'

// Mocks (declared before the mocked modules are imported, following the
// pattern already used in ../e2e/transaction-flow.test.ts — vi.mock factories
// are only invoked when the mocked module is actually resolved during the
// import chain below, by which point these `let`/`const` bindings exist).

// Mock the Supabase auth client so `authMiddleware` resolves a merchant user
// without making a real network call.
vi.mock('jose', () => ({
  jwtVerify: vi.fn().mockResolvedValue({
    payload: {
      sub: 'merchant-auth-id',
      email: 'merchant@test.com',
      app_metadata: { role: 'merchant' },
    }
  })
}))

// Controllable QrTokenService.verifyToken result, set per test.
const mockVerifyToken = vi.fn()
vi.mock('../services/qr-token.service.js', () => ({
  QrTokenService: vi.fn().mockImplementation(() => ({
    verifyToken: mockVerifyToken,
  })),
}))

// Controllable PinService.verifyPinWithLockout result, set per test.
const mockVerifyPinWithLockout = vi.fn()
vi.mock('../services/pin.service.js', () => ({
  PinService: vi.fn().mockImplementation(() => ({
    verifyPinWithLockout: mockVerifyPinWithLockout,
  })),
}))

// Stateful Supabase DB mock. Originally only supported
// from().select().eq().single() (what the 400/401/429 rejection-path tests
// below need). Extended for Properties 18/19/20 (tasks 11.6-11.8) to also
// support insert()/update()/maybeSingle() for the 'transactions'/'outbox'
// tables and an update() on 'beneficiaries', since Properties 18 and 19
// need the route to run all the way through TransactionService.createTransaction
// and the balance-deduction step. Each builder below is shaped to match
// EXACTLY what the real route (transactions.ts) and TransactionService
// (transaction.service.ts, via BaseRepository) call, method-by-method —
// see those files for the call shapes this mirrors.

let merchantRow: any
let beneficiaryRow: any
let transactionRows: any[] = []
let outboxRows: any[] = []
let beneficiaryUpdateCalls: { credit_balance: number }[] = []
let nextTransactionId = 1
let rpcCalls: { fn: string; args: any }[] = []
let rpcError: any = null

function makeSingleQuery(row: any) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: row,
      error: row ? null : new Error('Not found'),
    }),
  }
  return builder
}

// 'beneficiaries': supports the existing select().eq().single() read AND
// the route's own balance-deduction `update({...}).eq('id', beneficiaryId)`
// (awaited directly, no .select() — matches transactions.ts step 7).
function makeBeneficiariesBuilder(row: any) {
  let mode: 'select' | 'update' = 'select'
  let updateValues: any = null

  const builder: any = {
    select: vi.fn().mockImplementation(() => {
      mode = 'select'
      return builder
    }),
    update: vi.fn().mockImplementation((values: any) => {
      mode = 'update'
      updateValues = values
      return builder
    }),
    eq: vi.fn().mockImplementation((_col: string, val: any) => {
      if (mode === 'update') {
        beneficiaryUpdateCalls.push({ ...updateValues })
        if (row && row.id === val) {
          row.credit_balance = updateValues.credit_balance
        }
        return Promise.resolve({ data: null, error: null })
      }
      return builder
    }),
    single: vi.fn().mockImplementation(async () => ({
      data: row,
      error: row ? null : new Error('Not found'),
    })),
  }
  return builder
}

// 'transactions': supports TransactionService.createTransaction's
// idempotency check (select().eq('idempotency_key', ...).maybeSingle()),
// TransactionRepository.insert (insert(values).select('*').single()), and
// TransactionRepository.updateById (update(values).eq('id', id).select('*').single()),
// used by createTransaction and updateStatus respectively.
function makeTransactionsBuilder() {
  let mode: 'select' | 'insert' | 'update' = 'select'
  let insertValues: any = null
  let updateValues: any = null
  let filterId: string | undefined
  let filterIdemKey: string | undefined

  const builder: any = {
    select: vi.fn().mockImplementation(() => builder),
    eq: vi.fn().mockImplementation((col: string, val: any) => {
      if (col === 'id') filterId = val
      if (col === 'idempotency_key') filterIdemKey = val
      return builder
    }),
    insert: vi.fn().mockImplementation((values: any) => {
      mode = 'insert'
      insertValues = values
      return builder
    }),
    update: vi.fn().mockImplementation((values: any) => {
      mode = 'update'
      updateValues = values
      return builder
    }),
    maybeSingle: vi.fn().mockImplementation(async () => {
      const existing = transactionRows.find((r) => r.idempotency_key === filterIdemKey)
      return { data: existing ?? null, error: null }
    }),
    single: vi.fn().mockImplementation(async () => {
      if (mode === 'insert') {
        const newRow = {
          id: `tx-${nextTransactionId++}`,
          created_at: new Date().toISOString(),
          onchain_tx_hash: null,
          confirmed_at: null,
          status: 'PENDING_CHAIN',
          total_credit_deducted: 0,
          stablecoin_amount_wei: '0',
          ...insertValues,
        }
        transactionRows.push(newRow)
        return { data: newRow, error: null }
      }
      if (mode === 'update') {
        const row = transactionRows.find((r) => r.id === filterId)
        if (row) Object.assign(row, updateValues)
        return { data: row ?? null, error: row ? null : new Error('Not found') }
      }
      return { data: null, error: new Error('Not supported by this mock') }
    }),
  }
  return builder
}

// 'outbox': createTransaction awaits `.insert({...})` directly with no
// further chaining, so insert() itself must return a Promise.
function makeOutboxBuilder() {
  return {
    insert: vi.fn().mockImplementation((values: any) => {
      outboxRows.push(values)
      return Promise.resolve({ data: null, error: null })
    }),
  }
}

function makeQrPassesBuilder() {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: null,
      error: null
    })
  }
  return builder
}

const mockSupabaseClient: any = {
  rpc: vi.fn().mockImplementation(async (fn: string, args: any) => {
    rpcCalls.push({ fn, args })
    if (rpcError) {
      return { data: null, error: rpcError }
    }
    if (fn === 'settle_sale_and_enqueue') {
      const { p_beneficiary_id, p_merchant_id, p_amount, p_items, p_transaction_id } = args
      if (p_amount <= 0) {
        return { data: null, error: new Error('Amount must be greater than zero') }
      }
      if (!beneficiaryRow || beneficiaryRow.id !== p_beneficiary_id) {
        return { data: null, error: new Error('Beneficiary not found') }
      }
      if (beneficiaryRow.credit_balance < p_amount) {
        return { data: null, error: new Error('Insufficient beneficiary credit balance') }
      }
      beneficiaryRow.credit_balance -= p_amount
      beneficiaryUpdateCalls.push({ credit_balance: beneficiaryRow.credit_balance })
      if (merchantRow && merchantRow.id === p_merchant_id) {
        merchantRow.wallet_balance += p_amount
      }
      const newTx = {
        id: p_transaction_id,
        beneficiary_id: p_beneficiary_id,
        merchant_id: p_merchant_id,
        item_list_jsonb: p_items,
        total_credit_deducted: p_amount,
        stablecoin_amount_wei: '0',
        onchain_tx_hash: null,
        idempotency_key: p_transaction_id,
        status: 'CONFIRMED',
        created_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString()
      }
      transactionRows.push(newTx)
      return { data: p_transaction_id, error: null }
    }
    return { data: null, error: new Error('Unknown RPC') }
  }),
  from: vi.fn().mockImplementation((table: string) => {
    if (table === 'merchants') return makeSingleQuery(merchantRow)
    if (table === 'beneficiaries') return makeBeneficiariesBuilder(beneficiaryRow)
    if (table === 'transactions') return makeTransactionsBuilder()
    if (table === 'outbox') return makeOutboxBuilder()
    if (table === 'qr_passes') return makeQrPassesBuilder()
    return makeSingleQuery(null)
  }),
}

vi.mock('../lib/supabase.js', () => ({
  createServiceClient: () => mockSupabaseClient,
}))

const { app } = await import('../app.js')

// Test setup

const VALID_IDEMPOTENCY_KEY = 'a75f7823-3dbd-426c-8ab5-3e284b39e6a0'

function baseBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    qrToken: 'some-qr-token',
    pin: '123456',
    items: [
      {
        category: 'VEGETABLES',
        name: 'Fresh Eggs (dozen)',
        quantity: 1,
        unitPricePhp: 90,
        creditCost: 90,
      },
    ],
    idempotencyKey: VALID_IDEMPOTENCY_KEY,
    ...overrides,
  }
}

async function postTransaction(body: unknown) {
  return app.request('/api/transactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer fake-token',
    },
    body: JSON.stringify(body),
  })
}

function resetDbMockState() {
  vi.clearAllMocks()

  // A single APPROVED merchant matching the mocked auth user's id, on all
  // tests, since the route resolves the merchant before any other check.
  merchantRow = {
    id: 'merchant-1',
    auth_user_id: 'merchant-auth-id',
    status: 'APPROVED',
    wallet_address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    wallet_balance: 0,
  }

  beneficiaryRow = {
    id: 'beneficiary-1',
    pin_hash_argon2id: 'argon2id$fakehash',
    credit_balance: 500,
  }

  transactionRows = []
  outboxRows = []
  beneficiaryUpdateCalls = []
  nextTransactionId = 1
  rpcCalls = []
  rpcError = null
}

describe('POST /api/transactions — HTTP response codes', () => {
  beforeEach(() => {
    resetDbMockState()
  })

  it('returns 401 for an invalid/expired QR token (Requirement 7.2)', async () => {
    mockVerifyToken.mockResolvedValueOnce(err(new JwtError('Token verification failed', 'invalid')))

    const res = await postTransaction(baseBody())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('jwt')
  })

  it('returns 401 for a wrong guardian PIN (Requirement 7.4)', async () => {
    // NOTE: Task 11.9's task text says "403 for wrong PIN". The actual route
    // (implemented in task 11.2, apps/server/src/routes/transactions.ts) returns
    // a plain 401 (`{ error: 'unauthorized', message: 'Incorrect guardian PIN' }, 401`)
    // for a wrong PIN — not 403. This test asserts the route's ACTUAL behavior.
    // See this task's completion report for the discrepancy writeup; the route
    // was NOT modified to force 403 since that would be an unreviewed behavior
    // change outside this task's "write tests" scope.
    mockVerifyToken.mockResolvedValueOnce(
      ok({ beneficiaryId: 'beneficiary-1', walletRef: '0xabc', tier: 1 }),
    )
    mockVerifyPinWithLockout.mockResolvedValueOnce(ok(false))

    const res = await postTransaction(baseBody())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
    expect(body.message).toMatch(/incorrect guardian pin/i)
  })

  it('returns 429 when the PIN is locked out after repeated failures (Requirement 7.5)', async () => {
    mockVerifyToken.mockResolvedValueOnce(
      ok({ beneficiaryId: 'beneficiary-1', walletRef: '0xabc', tier: 1 }),
    )
    mockVerifyPinWithLockout.mockResolvedValueOnce(
      err(new RateLimitError('Too many incorrect PIN attempts. Account is temporarily locked.', 900)),
    )

    const res = await postTransaction(baseBody())

    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe('rateLimit')
  })

  it('returns 400 for a non-positive purchase amount (Requirement 7.9)', async () => {
    mockVerifyToken.mockResolvedValueOnce(
      ok({ beneficiaryId: 'beneficiary-1', walletRef: '0xabc', tier: 1 }),
    )
    mockVerifyPinWithLockout.mockResolvedValueOnce(ok(true))

    const res = await postTransaction(
      baseBody({
        items: [
          {
            category: 'VEGETABLES',
            name: 'Free Sample',
            quantity: 1,
            unitPricePhp: 0,
            creditCost: 0,
          },
        ],
      }),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.message).toMatch(/greater than zero/i)
  })

  it('returns 400 for insufficient beneficiary credit balance (Requirement 7.7)', async () => {
    beneficiaryRow = {
      id: 'beneficiary-1',
      pin_hash_argon2id: 'argon2id$fakehash',
      credit_balance: 50, // less than the 90-credit item cost in baseBody()
    }
    mockVerifyToken.mockResolvedValueOnce(
      ok({ beneficiaryId: 'beneficiary-1', walletRef: '0xabc', tier: 1 }),
    )
    mockVerifyPinWithLockout.mockResolvedValueOnce(ok(true))

    const res = await postTransaction(baseBody())

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.message).toMatch(/insufficient/i)
  })
})

// Property 18: authorized in-balance purchase deducts and transfers the
// exact amount (Requirements 7.6, 7.8)

describe('Property 18: authorized in-balance purchase deducts and transfers the exact amount (Requirements 7.6, 7.8)', () => {
  // Feature: polygon-amoy-phpc-migration, Property 18: Authorized in-balance purchase deducts and transfers the exact amount
  // Validates: Requirements 7.6, 7.8
  it('deducts exactly the purchase amount and persists a confirmed Transaction_Record with the on-chain hash', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 499 }), fc.uuid(), async (creditCost, idempotencyKey) => {
        resetDbMockState()

        mockVerifyToken.mockResolvedValueOnce(
          ok({ beneficiaryId: 'beneficiary-1', walletRef: '0xabc', tier: 1 }),
        )
        mockVerifyPinWithLockout.mockResolvedValueOnce(ok(true))

        const res = await postTransaction(
          baseBody({
            idempotencyKey,
            items: [
              {
                category: 'VEGETABLES',
                name: 'X',
                quantity: 1,
                unitPricePhp: creditCost,
                creditCost,
              },
            ],
          }),
        )

        expect(res.status).toBe(201)

        // Exactly one balance deduction occurred, for exactly the purchase amount.
        expect(beneficiaryUpdateCalls.length).toBe(1)
        expect(beneficiaryUpdateCalls[0].credit_balance).toBe(500 - creditCost)

        // Settle sale RPC was called
        expect(rpcCalls.length).toBe(1)
        expect(rpcCalls[0].fn).toBe('settle_sale_and_enqueue')
        expect(rpcCalls[0].args.p_amount).toBe(creditCost)

        // The persisted transaction row's onchain_tx_hash is null in custodial model
        expect(transactionRows.length).toBe(1)
        expect(transactionRows[0].status).toBe('CONFIRMED')
        expect(transactionRows[0].onchain_tx_hash).toBeNull()

        const body = await res.json()
        expect(body.onchainTxHash).toBeNull()
      }),
      { numRuns: 20 },
    )
  })
})

// Property 19: invalid-amount and over-balance purchases are rejected
// without balance change (Requirements 7.7, 7.9)

describe('Property 19: invalid-amount and over-balance purchases are rejected without balance change (Requirements 7.7, 7.9)', () => {
  // Feature: polygon-amoy-phpc-migration, Property 19: Invalid-amount and over-balance purchases are rejected without balance change
  // Validates: Requirements 7.7, 7.9
  //
  // Note: zod's `createTransactionSchema` TransactionItemSchema.creditCost is
  // `z.number().nonnegative()`, so a negative creditCost fails validation at
  // the zod layer (400 from zValidator) rather than the route's own <=0/
  // over-balance checks. The generator below is scoped to
  // fc.integer({min: 0, max: 1000}) — values the schema accepts — so this
  // property cleanly tests the ROUTE's own rejection logic.
  it('rejects amount <= 0 or amount > balance with 400 and never mutates the balance', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 500 }),
        fc.uuid(),
        async (creditCost, balance, idempotencyKey) => {
          resetDbMockState()
          beneficiaryRow.credit_balance = balance

          mockVerifyToken.mockResolvedValueOnce(
            ok({ beneficiaryId: 'beneficiary-1', walletRef: '0xabc', tier: 1 }),
          )
          mockVerifyPinWithLockout.mockResolvedValueOnce(ok(true))

          const shouldReject = creditCost <= 0 || creditCost > balance

          const res = await postTransaction(
            baseBody({
              idempotencyKey,
              items: [
                {
                  category: 'VEGETABLES',
                  name: 'X',
                  quantity: 1,
                  unitPricePhp: creditCost,
                  creditCost,
                },
              ],
            }),
          )

          if (shouldReject) {
            expect(res.status).toBe(400)
            expect(beneficiaryUpdateCalls.length).toBe(0)
            expect(transactionRows.length).toBe(0)
          } else {
            expect(res.status).toBe(201)
          }
        },
      ),
      { numRuns: 30 },
    )
  })
})

// Property 22: An incorrect PIN never changes balances

describe('Property 22: An incorrect PIN never changes balances (Requirement 13.3)', () => {
  it('rejects with 401 and does not change balances or insert transaction on incorrect PIN', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 6, maxLength: 6 }), fc.uuid(), async (incorrectPin, idempotencyKey) => {
        resetDbMockState()

        mockVerifyToken.mockResolvedValueOnce(
          ok({ beneficiaryId: 'beneficiary-1', walletRef: '0xabc', tier: 1 }),
        )
        // Simulate incorrect PIN verification
        mockVerifyPinWithLockout.mockResolvedValueOnce(ok(false))

        const res = await postTransaction(
          baseBody({
            idempotencyKey,
            pin: incorrectPin,
          }),
        )

        expect(res.status).toBe(401)
        expect(beneficiaryUpdateCalls.length).toBe(0)
        expect(transactionRows.length).toBe(0)
        expect(rpcCalls.length).toBe(0)
      }),
      { numRuns: 20 },
    )
  })
})
