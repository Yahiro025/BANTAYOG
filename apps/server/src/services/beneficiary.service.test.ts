import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'
import { ok, err } from 'neverthrow'
import { BeneficiaryService } from './beneficiary.service.js'
import { QrTokenService } from './qr-token.service.js'
import { StellarClient } from './chain.client.js'
import { OnchainError } from '../lib/errors.js'

// Controllable StellarClient.create result, set per test/property run
// below. `BeneficiaryService.register` now ALSO calls `StellarClient.create`
// to provision the generated wallet on-chain (non-blocking on failure), so
// every describe block below must provide a resolved value — default to a
// successful create with a no-op `provisionAccount` unless a specific test
// overrides it to exercise a provisioning failure.
vi.mock('./chain.client.js', () => ({
  StellarClient: {
    create: vi.fn(),
  },
}))

// Unit tests for BeneficiaryService.register's custodial-wallet wiring.
// Validates: Requirements 5.5 — a successful registration persists exactly
// one `beneficiary_wallets` row and the QR token payload's `walletRef`
// matches the stored wallet address.

// ── Minimal stateful mock DB (self-contained; not imported from e2e tests) ──
let mockDbState: Record<string, any[]> = {
  beneficiaries: [],
  beneficiary_wallets: [],
  qr_passes: [],
  allocations: [],
}

function resetMockDbState() {
  mockDbState = {
    beneficiaries: [],
    beneficiary_wallets: [],
    qr_passes: [],
    allocations: [],
  }
}

function createSelectBuilder(_table: string, data: any[]) {
  let filtered = [...data]
  const count = data.length

  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation((col: string, val: any) => {
      filtered = filtered.filter((r) => r[col] === val)
      return chain
    }),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation((n: number) => {
      filtered = filtered.slice(0, n)
      return chain
    }),
    single: vi.fn().mockResolvedValue({
      data: filtered[0] || null,
      error: filtered.length === 0 ? new Error('Not found') : null,
    }),
    maybeSingle: vi.fn().mockResolvedValue({
      data: filtered[0] || null,
      error: null,
    }),
    then: (onFulfilled: any) =>
      Promise.resolve({ data: filtered, count, error: null }).then(onFulfilled),
  }
  return chain
}

const mockSupabaseClient: any = {
  from: vi.fn().mockImplementation((table: string) => {
    const tableData = mockDbState[table] || []

    return {
      select: vi.fn().mockImplementation(() => createSelectBuilder(table, tableData)),
      insert: vi.fn().mockImplementation((data: any) => {
        const rows = Array.isArray(data) ? data : [data]
        const inserted = rows.map((row) => ({
          id: row.id || `gen-${Math.random().toString(36).substring(2, 10)}`,
          ...row,
          created_at: row.created_at || new Date().toISOString(),
        }))
        mockDbState[table]?.push(...inserted)
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: inserted[0], error: null }),
          }),
          single: vi.fn().mockResolvedValue({ data: inserted[0], error: null }),
          then: (onFulfilled: any) =>
            Promise.resolve({ data: inserted, error: null }).then(onFulfilled),
        }
      }),
      // Minimal `.delete().eq(...)` support so `BaseRepository.deleteById`
      // (used by the compensating rollback in `BeneficiaryService.register`)
      // works against this mock. `await x.delete().eq(col, val)` never
      // awaits a further `.select()`/`.single()`, so `.eq()` can just return
      // a plain `{ error, count }` value directly (a non-promise resolves
      // immediately under `await`).
      delete: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation((col: string, val: any) => {
          const rows = mockDbState[table] || []
          const before = rows.length
          mockDbState[table] = rows.filter((r) => r[col] !== val)
          const count = before - (mockDbState[table]?.length ?? 0)
          return { error: null, count }
        }),
      })),
      // Minimal `.update(values).eq('id', id).select('*').single()` support
      // so `BaseRepository.updateById` (used by `allocateTierCredits`'s
      // balance update and `reconcileAllocation`'s `reconciled` flag update,
      // Tasks 10.3–10.5) mutates `mockDbState[table]` in place.
      update: vi.fn().mockImplementation((values: any) => ({
        eq: vi.fn().mockImplementation((col: string, val: any) => {
          const rows = mockDbState[table] || []
          const idx = rows.findIndex((r) => r[col] === val)
          if (idx !== -1) {
            rows[idx] = { ...rows[idx], ...values }
          }
          const updated = idx !== -1 ? rows[idx] : null
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: updated,
                error: updated ? null : new Error('Not found'),
              }),
            }),
            single: vi.fn().mockResolvedValue({
              data: updated,
              error: updated ? null : new Error('Not found'),
            }),
          }
        }),
      })),
      eq: vi
        .fn()
        .mockImplementation((col: string, val: any) => createSelectBuilder(table, tableData).eq(col, val)),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  }),
}

describe('BeneficiaryService.register — custodial wallet wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockDbState()

    vi.stubEnv('STELLAR_HORIZON_URL', 'https://horizon-testnet.stellar.org')
    vi.stubEnv('STELLAR_NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015')
    vi.stubEnv('PHPC_ASSET_CODE', 'PHPC')
    vi.stubEnv('PHPC_ISSUER_PUBLIC_KEY', 'GDVIX3H4TPPZ3ZR5TBYGV2BHVT5KZGIIACXPGTS3WJI7FCLIQMDKXBP6')
    vi.stubEnv('PHPC_ISSUER_SECRET', 'SBLOCMCBZRMHGNNELJSDHS2UKCDI2KWDVTPQGJLX3IWM34ZTDOID7XCI')
    vi.stubEnv('PHPC_DISTRIBUTION_SECRET', 'SD2ZBARMFVIIPB75WKI6GOEATW3CWEZ3FCMFRLWPS4H34KLP2WLXVKTR')
    vi.stubEnv('STELLAR_SPONSOR_SECRET', 'SA5BA56CFEMCKAYOCKWQ7FRQHXG7VDMBLTHLAPUNKBYRY7P3R2XDIWKM')
    vi.stubEnv('CUSTODIAL_KEY_ENCRYPTION_KEY', 'test-key-encryption-key')
    vi.stubEnv('QR_TOKEN_SECRET', 'test-qr-token-secret')

    // Default: StellarClient constructs successfully and provisioning
    // succeeds, so these tests exercise the DB-persistence assertions
    // without depending on Horizon connectivity.
    ;(StellarClient.create as any).mockResolvedValue(
      ok({
        provisionAccount: vi.fn().mockResolvedValue(ok(undefined)),
      }),
    )
  })

  it('persists exactly one beneficiary_wallets row and embeds a matching walletRef in the QR token on successful registration', async () => {
    const service = new BeneficiaryService(mockSupabaseClient)

    const result = await service.register({
      guardianName: 'Maria Dela Cruz',
      guardianMobileHash: 'sha256-mobile-hash-1',
      childName: 'Juan Dela Cruz',
      childAgeMonths: 6,
      monthlyIncomePhp: 5000,
      gpsLat: 14.6,
      gpsLng: 121.0,
      pin: '123456',
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    // Exactly one beneficiary_wallets row was persisted.
    expect(mockDbState.beneficiary_wallets.length).toBe(1)
    const storedAddress = mockDbState.beneficiary_wallets[0].address

    // Decode the QR token and confirm walletRef matches the stored address.
    const qrTokenService = new QrTokenService()
    const verifyResult = await qrTokenService.verifyToken(result.value.qrToken)
    expect(verifyResult.isOk()).toBe(true)
    if (verifyResult.isOk()) {
      expect(verifyResult.value.walletRef).toBe(storedAddress)
    }
  })

  it('returns ok(...) with beneficiary, tier, qrToken, and cardSerial populated', async () => {
    const service = new BeneficiaryService(mockSupabaseClient)

    const result = await service.register({
      guardianName: 'Ana Santos',
      guardianMobileHash: 'sha256-mobile-hash-2',
      childName: 'Pedro Santos',
      childAgeMonths: 8,
      monthlyIncomePhp: 6000,
      gpsLat: 14.55,
      gpsLng: 121.02,
      pin: '654321',
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    expect(result.value.beneficiary).toBeDefined()
    expect(result.value.beneficiary.child_name).toBe('Pedro Santos')
    expect(typeof result.value.tier).toBe('number')
    expect(result.value.qrToken.length).toBeGreaterThan(20)
    expect(result.value.cardSerial).toMatch(/^BTY-/)
  })
})

// Property 15: Registration wallet failure persists no partial state.
// Validates: Requirements 5.6
// Feature: polygon-amoy-phpc-migration, Property 15: when custodial wallet
// generation fails during registration, no beneficiary record and no
// partial beneficiary_wallets row are left persisted (the compensating
// delete removes the just-inserted beneficiary row).
describe('Property 15: registration wallet failure persists no partial state', () => {
  const originalFrom = mockSupabaseClient.from

  beforeEach(() => {
    vi.clearAllMocks()
    resetMockDbState()

    vi.stubEnv('STELLAR_HORIZON_URL', 'https://horizon-testnet.stellar.org')
    vi.stubEnv('STELLAR_NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015')
    vi.stubEnv('PHPC_ASSET_CODE', 'PHPC')
    vi.stubEnv('PHPC_ISSUER_PUBLIC_KEY', 'GDVIX3H4TPPZ3ZR5TBYGV2BHVT5KZGIIACXPGTS3WJI7FCLIQMDKXBP6')
    vi.stubEnv('PHPC_ISSUER_SECRET', 'SBLOCMCBZRMHGNNELJSDHS2UKCDI2KWDVTPQGJLX3IWM34ZTDOID7XCI')
    vi.stubEnv('PHPC_DISTRIBUTION_SECRET', 'SD2ZBARMFVIIPB75WKI6GOEATW3CWEZ3FCMFRLWPS4H34KLP2WLXVKTR')
    vi.stubEnv('STELLAR_SPONSOR_SECRET', 'SA5BA56CFEMCKAYOCKWQ7FRQHXG7VDMBLTHLAPUNKBYRY7P3R2XDIWKM')
    vi.stubEnv('CUSTODIAL_KEY_ENCRYPTION_KEY', 'test-key-encryption-key')
    vi.stubEnv('QR_TOKEN_SECRET', 'test-qr-token-secret')

    // Force the `beneficiary_wallets` insert (what
    // `CustodialWalletService.generateWallet`'s `this.repo.insert(...)`
    // ultimately calls via `BaseRepository.insert`'s
    // `.insert(values).select('*').single()` chain) to resolve an error,
    // simulating a wallet-generation persistence failure. The `beneficiaries`
    // table insert is left untouched so the beneficiary row gets created
    // first, exactly matching the real failure scenario the compensating
    // delete in `BeneficiaryService.register` handles.
    mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
      const builder = originalFrom(table)
      if (table === 'beneficiary_wallets') {
        builder.insert = vi.fn().mockImplementation(() => {
          const error = new Error('simulated wallet insert failure')
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error }),
            }),
            single: vi.fn().mockResolvedValue({ data: null, error }),
            then: (onFulfilled: any) =>
              Promise.resolve({ data: null, error }).then(onFulfilled),
          }
        })
      }
      return builder
    })
  })

  afterEach(() => {
    mockSupabaseClient.from = originalFrom
    vi.unstubAllEnvs()
  })

  it('when wallet generation fails, no beneficiary record and no partial wallet data are persisted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          guardianName: fc.string({ minLength: 1, maxLength: 50 }),
          childName: fc.string({ minLength: 1, maxLength: 50 }),
          childAgeMonths: fc.integer({ min: 0, max: 60 }),
        }),
        async (dto) => {
          resetMockDbState()

          const service = new BeneficiaryService(mockSupabaseClient)
          const result = await service.register({
            guardianName: dto.guardianName,
            guardianMobileHash: 'hash-' + dto.guardianName,
            childName: dto.childName,
            childAgeMonths: dto.childAgeMonths,
            monthlyIncomePhp: 5000,
            gpsLat: 14.6,
            gpsLng: 121.0,
            pin: '123456',
          })

          // Registration must report failure — the wallet-generation error.
          expect(result.isErr()).toBe(true)
          // No beneficiary record persisted (compensating delete ran).
          expect(mockDbState.beneficiaries.length).toBe(0)
          // No partial wallet data persisted either.
          expect(mockDbState.beneficiary_wallets.length).toBe(0)
        },
      ),
      { numRuns: 100 },
    )
  }, 120000)
})

// Shared env stubbing for the allocation/reconciliation property tests below
// (Tasks 10.3–10.5). These mirror the exact Polygon Amoy env vars stubbed
// for the Property 15 suite above, since `allocateTierCredits`/
// `reconcileAllocation` both call `loadChainConfig(process.env)`.

function stubAllocationEnv() {
  vi.stubEnv('STELLAR_HORIZON_URL', 'https://horizon-testnet.stellar.org')
  vi.stubEnv('STELLAR_NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015')
  vi.stubEnv('PHPC_ASSET_CODE', 'PHPC')
  vi.stubEnv('PHPC_ISSUER_PUBLIC_KEY', 'GDVIX3H4TPPZ3ZR5TBYGV2BHVT5KZGIIACXPGTS3WJI7FCLIQMDKXBP6')
  vi.stubEnv('PHPC_ISSUER_SECRET', 'SBLOCMCBZRMHGNNELJSDHS2UKCDI2KWDVTPQGJLX3IWM34ZTDOID7XCI')
  vi.stubEnv('PHPC_DISTRIBUTION_SECRET', 'SD2ZBARMFVIIPB75WKI6GOEATW3CWEZ3FCMFRLWPS4H34KLP2WLXVKTR')
  vi.stubEnv('STELLAR_SPONSOR_SECRET', 'SA5BA56CFEMCKAYOCKWQ7FRQHXG7VDMBLTHLAPUNKBYRY7P3R2XDIWKM')
  vi.stubEnv('CUSTODIAL_KEY_ENCRYPTION_KEY', 'test-key-encryption-key')
  vi.stubEnv('QR_TOKEN_SECRET', 'test-qr-token-secret')
}

// Property 6: Tier allocation credits the correct amount and conserves
// total supply.
// Validates: Requirements 4.1, 4.2, 4.3, 4.5
// Feature: polygon-amoy-phpc-migration, Property 6: for either tier, a
// successful allocation increases the beneficiary's recorded balance by
// exactly the tier amount (5000 for Tier 1, 3500 for Tier 2) and persists
// exactly one `allocations` row recording that same tier/amount — the
// allocation's Transaction_Record per the design's data model.
describe('Property 6: tier allocation credits the correct amount and conserves total supply (Requirements 4.1, 4.2, 4.3, 4.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockDbState()
    stubAllocationEnv()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('increases the beneficiary balance by exactly the tier amount and records a matching allocation row', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(1, 2), fc.uuid(), async (tier, beneficiaryId) => {
        resetMockDbState()

        const tierAmount = tier === 1 ? 5000 : 3500

        ;(StellarClient.create as any).mockResolvedValue(
          ok({
            hasAuthorizedTrustline: vi.fn().mockResolvedValue(ok(true)),
            allocateSubsidy: vi.fn().mockResolvedValue(ok({ hash: 'stellarhash123', ledger: 42 })),
          }),
        )

        // Fixture chosen well within each tier's range (per
        // `domain/eligibility.ts`'s conception-day arithmetic) to avoid
        // boundary flakiness: a newborn (childAgeMonths=0, just registered)
        // is always Tier 1; a 40-month-old is always Tier 2.
        const beneficiary = {
          id: beneficiaryId,
          credit_balance: 0,
          created_at: new Date().toISOString(),
          child_age_months: tier === 1 ? 0 : 40,
        }
        mockDbState.beneficiaries.push(beneficiary)

        // Provide a provisioned wallet for the trustline check
        mockDbState.beneficiary_wallets.push({
          beneficiary_id: beneficiaryId,
          address: 'GBZFCMQFAKQTAC7THZMRGVBM5QXRDRFEJXT6XLBRIAAGIQCH5WGE2PW2',
        })

        const service = new BeneficiaryService(mockSupabaseClient)
        const result = await service.allocateTierCredits(beneficiaryId)

        expect(result.isOk()).toBe(true)
        if (result.isOk()) {
          expect(result.value.amount).toBe(tierAmount)
        }

        const updated = mockDbState.beneficiaries.find((b: any) => b.id === beneficiaryId)
        expect(Number(updated.credit_balance)).toBe(tierAmount)

        // Exactly one allocation row was recorded with the correct
        // tier/amount — this is the allocation's Transaction_Record.
        expect(mockDbState.allocations.length).toBe(1)
        expect(mockDbState.allocations[0].tier).toBe(tier)
        expect(mockDbState.allocations[0].amount_phpc).toBe(tierAmount)
        // F7: the ledger sequence returned by allocateSubsidy is actually
        // persisted alongside the transaction hash, not silently discarded.
        expect(mockDbState.allocations[0].ledger_sequence).toBe(42)
        expect(mockDbState.allocations[0].onchain_tx_hash).toBe('stellarhash123')
      }),
      { numRuns: 20 },
    )
  })
})

// Property 7: Rejected allocations leave balances unchanged.
// Validates: Requirements 4.4, 4.7, 4.8, 4.9
// Feature: polygon-amoy-phpc-migration, Property 7: for each reachable
// rejection cause (insufficient treasury, duplicate allocation, on-chain
// failure), the beneficiary's recorded balance stays at 0 and no new
// `allocations` row is inserted. Requirement 4.9's invalid-tier rejection
// path is not exercised here since `computeTier` only ever returns 1 | 2 by
// its type signature — that branch is a defensive/unreachable guard, as
// noted in `allocateTierCredits`'s own code comment.
describe('Property 7: rejected allocations leave balances unchanged (Requirements 4.4, 4.7, 4.8, 4.9)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockDbState()
    stubAllocationEnv()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('leaves the beneficiary balance at 0 and inserts no new allocation row when rejected for missing trustline, duplicate allocation, or on-chain failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('missing_trustline', 'duplicate_allocation', 'onchain_failure'),
        fc.uuid(),
        async (rejectionCause, beneficiaryId) => {
          resetMockDbState()

          const beneficiary = {
            id: beneficiaryId,
            credit_balance: 0,
            created_at: new Date().toISOString(),
            child_age_months: 0,
          }
          mockDbState.beneficiaries.push(beneficiary)

          // Provide a wallet row so the wallet lookup succeeds
          mockDbState.beneficiary_wallets.push({
            beneficiary_id: beneficiaryId,
            address: 'GBZFCMQFAKQTAC7THZMRGVBM5QXRDRFEJXT6XLBRIAAGIQCH5WGE2PW2',
          })

          if (rejectionCause === 'duplicate_allocation') {
            mockDbState.allocations.push({
              id: 'existing-alloc',
              beneficiary_id: beneficiaryId,
              tier: 1,
              amount_phpc: 5000,
              onchain_tx_hash: 'stellarhash',
              reconciled: false,
              allocated_at: new Date().toISOString(),
            })
          }

          ;(StellarClient.create as any).mockResolvedValue(
            ok({
              hasAuthorizedTrustline: vi.fn().mockResolvedValue(
                rejectionCause === 'missing_trustline' ? ok(false) : ok(true),
              ),
              allocateSubsidy: vi
                .fn()
                .mockResolvedValue(
                  rejectionCause === 'onchain_failure'
                    ? err(new OnchainError('simulated failure', 0))
                    : ok({ hash: 'stellarhash', ledger: 42 }),
                ),
            }),
          )

          const service = new BeneficiaryService(mockSupabaseClient)
          const result = await service.allocateTierCredits(beneficiaryId)

          expect(result.isErr()).toBe(true)
          const unchanged = mockDbState.beneficiaries.find((b: any) => b.id === beneficiaryId)
          expect(Number(unchanged.credit_balance)).toBe(0)

          if (rejectionCause !== 'duplicate_allocation') {
            expect(mockDbState.allocations.length).toBe(0)
          } else {
            // The pre-existing allocation row is left unchanged; no new one added.
            expect(mockDbState.allocations.length).toBe(1)
          }
        },
      ),
      { numRuns: 20 },
    )
  })
})

// Property 8: Reconciliation mismatch flags the allocation.
// Validates: Requirement 4.6
// Feature: polygon-amoy-phpc-migration, Property 8: when the beneficiary's
// recorded `credit_balance` diverges from the recorded allocation's
// `amount_phpc`, `reconcileAllocation` returns an identifying error and
// leaves (or sets) the allocation's `reconciled` flag to `false`.
describe('Property 8: reconciliation mismatch flags the allocation (Requirement 4.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockDbState()
    stubAllocationEnv()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('flags reconciled=false and returns an identifying error when the recorded balance diverges from the allocation amount', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 5001, max: 10000 }),
        async (beneficiaryId, recordedBalance, allocationAmount) => {
          resetMockDbState()

          mockDbState.beneficiaries.push({
            id: beneficiaryId,
            credit_balance: recordedBalance,
            created_at: new Date().toISOString(),
            child_age_months: 0,
          })
          mockDbState.allocations.push({
            id: 'alloc-1',
            beneficiary_id: beneficiaryId,
            tier: 1,
            amount_phpc: allocationAmount,
            onchain_tx_hash: '0xtxhash',
            reconciled: false,
            allocated_at: new Date().toISOString(),
          })

          ;(StellarClient.create as any).mockResolvedValue(
            ok({
              // On-chain re-confirmation succeeds; the mismatch under test
              // is purely the recorded-balance-vs-amount divergence.
              waitForConfirmation: vi.fn().mockResolvedValue(ok({})),
            }),
          )

          const service = new BeneficiaryService(mockSupabaseClient)
          const result = await service.reconcileAllocation(beneficiaryId)

          expect(result.isErr()).toBe(true)
          const alloc = mockDbState.allocations.find((a: any) => a.id === 'alloc-1')
          expect(alloc.reconciled).toBe(false)
        },
      ),
      { numRuns: 20 },
    )
  })
})
