import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { ok, err } from 'neverthrow'
import { JwtError } from '../lib/errors.js'

// Mocks (declared before the mocked modules are imported, following the
// same pattern used in ./transactions.test.ts).

// Balance route never touches @supabase/supabase-js's `createClient`
// directly (no authMiddleware is mounted on /api/balance), but the module
// is still imported transitively via other routes wired into app.ts, so it
// is mocked defensively to avoid any real network call.
vi.mock('jose', () => ({
  jwtVerify: vi.fn().mockResolvedValue({ payload: null })
}))

// Controllable QrTokenService.verifyToken result, set per test.
const mockVerifyToken = vi.fn()
vi.mock('../services/qr-token.service.js', () => ({
  QrTokenService: vi.fn().mockImplementation(() => ({
    verifyToken: mockVerifyToken,
  })),
}))

// Minimal stateful Supabase DB mock — only supports what the balance route
// actually calls:
//   db.from('beneficiaries').select().eq().single()
//   db.from('transactions').select().eq().order().limit()

let beneficiaryRow: any
let transactionRows: any[]

function makeBeneficiaryQuery(row: any) {
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

function makeTransactionsQuery(rows: any[]) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  return builder
}

function makeQrPassesQuery() {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  return builder
}

const mockSupabaseClient: any = {
  from: vi.fn().mockImplementation((table: string) => {
    if (table === 'beneficiaries') return makeBeneficiaryQuery(beneficiaryRow)
    if (table === 'transactions') return makeTransactionsQuery(transactionRows)
    if (table === 'qr_passes') return makeQrPassesQuery()
    return makeBeneficiaryQuery(null)
  }),
}

vi.mock('../lib/supabase.js', () => ({
  createServiceClient: () => mockSupabaseClient,
}))

const { app } = await import('../app.js')

// Test setup

async function getBalance(query: string) {
  return app.request(`/api/balance/view${query}`, { method: 'GET' })
}

describe('GET /api/balance/view — read-only surface and no-PIN access', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    beneficiaryRow = {
      id: 'beneficiary-1',
      credit_balance: 500,
    }

    transactionRows = [
      {
        total_credit_deducted: 90,
        onchain_tx_hash: '0xhash1',
        status: 'CONFIRMED',
        created_at: '2024-01-02T00:00:00.000Z',
        confirmed_at: '2024-01-02T00:05:00.000Z',
      },
    ]

    mockVerifyToken.mockResolvedValue(
      ok({
        beneficiaryId: 'beneficiary-1',
        walletRef: '0xabc',
        tier: 1,
        childName: 'Test Child',
        guardianName: 'Test Guardian',
        pin_hash_ref: 'argon2id$fakehash',
      }),
    )
  })

  // Requirement 8.3: no PIN required or accepted

  it('succeeds with only a token and no pin param at all (Requirement 8.3)', async () => {
    const res = await getBalance('?token=some-valid-token')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.balance).toBe(500)
  })

  it('succeeds identically even if an extraneous pin param is supplied, proving it is ignored (Requirement 8.3)', async () => {
    const withoutPin = await getBalance('?token=some-valid-token')
    const withPin = await getBalance('?token=some-valid-token&pin=123456')

    expect(withoutPin.status).toBe(200)
    expect(withPin.status).toBe(200)

    const bodyWithoutPin = await withoutPin.json()
    const bodyWithPin = await withPin.json()

    // Same result either way — the route never reads/uses the pin param.
    expect(bodyWithPin).toEqual(bodyWithoutPin)
  })

  // Requirements 8.1, 8.5: read-only response surface, no mutating controls

  it('returns a top-level body with only balance and transactions keys (Requirement 8.5)', async () => {
    const res = await getBalance('?token=some-valid-token')

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(Object.keys(body).sort()).toEqual(['balance', 'transactions'])
  })

  it('returns transaction entries with only the BalanceViewTransactionDTO keys and no actionable/mutating fields (Requirements 8.1, 8.5)', async () => {
    const res = await getBalance('?token=some-valid-token')

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.transactions).toHaveLength(1)
    expect(Object.keys(body.transactions[0]).sort()).toEqual(
      ['amount', 'confirmedAt', 'createdAt', 'onchainTxHash', 'status'].sort(),
    )

    // No merchantId, id, items, idempotencyKey, or other field that could be
    // used to initiate a further create/modify/deduct action.
    expect(body.transactions[0]).not.toHaveProperty('id')
    expect(body.transactions[0]).not.toHaveProperty('merchantId')
    expect(body.transactions[0]).not.toHaveProperty('idempotencyKey')
    expect(body.transactions[0]).not.toHaveProperty('items')
  })

  it('contains no key suggestive of a mutating action anywhere in the response (Requirement 8.1)', async () => {
    const res = await getBalance('?token=some-valid-token')

    expect(res.status).toBe(200)
    const body = await res.json()

    // Exact key-set assertions above are the primary, rigorous proof of "no
    // controls". This is a pragmatic secondary check on top of that — checked
    // per-key (not as a substring of the whole JSON blob) so that legitimate
    // field names like "transactions" don't false-positive against "action".
    const suspiciousKeyPattern = /^(delete|update|mutate|action|link)/i
    for (const key of Object.keys(body)) {
      expect(key).not.toMatch(suspiciousKeyPattern)
    }
    for (const key of Object.keys(body.transactions[0])) {
      expect(key).not.toMatch(suspiciousKeyPattern)
    }
  })

  it('does not accept POST — the endpoint is inherently read-only in HTTP semantics (Requirement 8.1)', async () => {
    const res = await app.request('/api/balance/view?token=some-valid-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '123456' }),
    })

    // Hono falls through to the app-level notFound handler for a method
    // that has no registered handler on a matched path — never a 200.
    expect(res.status).not.toBe(200)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  // Sanity: existing failure-path behavior is unaffected (not a PIN check)

  it('returns 401-mapped error for an invalid/expired token, independent of any pin param', async () => {
    mockVerifyToken.mockResolvedValueOnce(err(new JwtError('Token verification failed', 'invalid')))

    const res = await getBalance('?token=bad-token&pin=999999')

    expect(res.status).not.toBe(200)
    const body = await res.json()
    expect(body.error).toBe('invalid_pass')
  })
})

// Property 24: Balance view returns the beneficiary's own history, ordered
// and capped (Requirements 8.2, 8.4)

// Feature: polygon-amoy-phpc-migration, Property 24: Balance view returns the beneficiary's own history, ordered and capped
// Validates: Requirements 8.2, 8.4
describe("Property 24: balance view returns the beneficiary's own history, ordered and capped (Requirements 8.2, 8.4)", () => {
  it("always scopes the transaction query to the token's beneficiary and requests it ordered most-recent-first, capped at 50", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.integer({ min: 0, max: 100 }), async (beneficiaryId, rowCount) => {
        beneficiaryRow = { id: beneficiaryId, credit_balance: 500 }
        transactionRows = Array.from({ length: Math.min(rowCount, 50) }, (_, i) => ({
          total_credit_deducted: i,
          onchain_tx_hash: `0xhash${i}`,
          status: 'CONFIRMED',
          created_at: new Date(2024, 0, i + 1).toISOString(),
          confirmed_at: new Date(2024, 0, i + 1).toISOString(),
        }))
        mockVerifyToken.mockResolvedValue(
          ok({ beneficiaryId, walletRef: '0xabc', tier: 1, childName: 'X', guardianName: 'Y', pin_hash_ref: 'z' }),
        )

        // Spy on the mock's eq/order/limit calls to confirm the route scopes
        // the query to THIS beneficiary and requests the correct
        // ordering/cap. The mock itself doesn't enforce sort order or the
        // row cap server-side (a real Supabase/Postgres backend would do
        // that), so this test verifies the route ASKS for them correctly
        // rather than re-proving a DB-level guarantee.
        let capturedEqArgs: [string, string] | undefined
        let capturedOrderArgs: { col: string; opts: unknown } | undefined
        let capturedLimitArg: number | undefined
        const originalFrom = mockSupabaseClient.from
        mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
          const builder = originalFrom(table)
          if (table === 'transactions') {
            // Bind with `.call(builder, ...)` so the wrapped
            // `mockReturnThis()` implementations still resolve `this` to
            // the builder (calling them as bare functions would lose that
            // binding and break the chain).
            const originalEq = builder.eq
            builder.eq = vi.fn().mockImplementation((col: string, val: string) => {
              capturedEqArgs = [col, val]
              return originalEq.call(builder, col, val)
            })
            const originalOrder = builder.order
            builder.order = vi.fn().mockImplementation((col: string, opts: unknown) => {
              capturedOrderArgs = { col, opts }
              return originalOrder.call(builder, col, opts)
            })
            const originalLimit = builder.limit
            builder.limit = vi.fn().mockImplementation((n: number) => {
              capturedLimitArg = n
              return originalLimit.call(builder, n)
            })
          }
          return builder
        })

        const res = await getBalance('?token=some-token')

        mockSupabaseClient.from = originalFrom

        expect(res.status).toBe(200)

        expect(capturedEqArgs).toEqual(['beneficiary_id', beneficiaryId])
        expect(capturedOrderArgs).toMatchObject({ col: 'created_at', opts: { ascending: false } })
        expect(capturedLimitArg).toBe(50)

        const body = await res.json()
        expect(body.transactions.length).toBeLessThanOrEqual(50)
      }),
      { numRuns: 30 },
    )
  })
})

// Property 25: Balance view withholds all data on invalid access or
// retrieval failure (Requirements 8.6, 8.7, 8.8)

// Feature: polygon-amoy-phpc-migration, Property 25: Balance view withholds all data on invalid access or retrieval failure
// Validates: Requirements 8.6, 8.7, 8.8
describe('Property 25: balance view withholds all data on invalid access or retrieval failure (Requirements 8.6, 8.7, 8.8)', () => {
  it('never includes a balance or transactions field when the token is invalid, the beneficiary cannot be matched, or retrieval fails', async () => {
    const originalFrom = mockSupabaseClient.from

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('invalid_token', 'not_matched', 'retrieval_failure'),
        async (failureMode) => {
          // Reset to a known-good baseline each iteration since beforeEach
          // only runs once per `it()`, not per fast-check iteration.
          mockSupabaseClient.from = originalFrom
          beneficiaryRow = { id: 'beneficiary-1', credit_balance: 500 }
          transactionRows = []

          if (failureMode === 'invalid_token') {
            mockVerifyToken.mockResolvedValueOnce(err(new JwtError('bad token', 'invalid')))
          } else if (failureMode === 'not_matched') {
            mockVerifyToken.mockResolvedValue(
              ok({ beneficiaryId: 'ghost-id', walletRef: '0xabc', tier: 1, childName: 'X', guardianName: 'Y', pin_hash_ref: 'z' }),
            )
            beneficiaryRow = null // simulate "not found"
          } else {
            mockVerifyToken.mockResolvedValue(
              ok({ beneficiaryId: 'beneficiary-1', walletRef: '0xabc', tier: 1, childName: 'X', guardianName: 'Y', pin_hash_ref: 'z' }),
            )
            beneficiaryRow = { id: 'beneficiary-1', credit_balance: 500 }
            // Force the transactions query to fail.
            mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
              if (table === 'transactions') {
                return {
                  select: vi.fn().mockReturnThis(),
                  eq: vi.fn().mockReturnThis(),
                  order: vi.fn().mockReturnThis(),
                  limit: vi.fn().mockResolvedValue({ data: null, error: new Error('simulated retrieval failure') }),
                }
              }
              return originalFrom(table)
            })
          }

          const res = await getBalance('?token=some-token')
          expect(res.status).not.toBe(200)

          const body = await res.json()
          expect(body).not.toHaveProperty('balance')
          expect(body).not.toHaveProperty('transactions')
        },
      ),
      { numRuns: 15 },
    )

    mockSupabaseClient.from = originalFrom
  })
})
