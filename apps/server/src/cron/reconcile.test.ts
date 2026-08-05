import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ok, err, OnchainError } from '../lib/errors.js'

// Mocks

let mockDbState: {
  outbox: any[]
  transactions: any[]
  merchant_wallets: any[]
  beneficiary_wallets: any[]
} = { outbox: [], transactions: [], merchant_wallets: [], beneficiary_wallets: [] }

function resetMockDbState() {
  mockDbState = { outbox: [], transactions: [], merchant_wallets: [], beneficiary_wallets: [] }
}

// A minimal chainable Supabase-like mock supporting the exact call shapes
// `reconcile.ts` uses: select/eq/order/limit for reads, update/eq for writes.
function buildTableMock(table: keyof typeof mockDbState) {
  return {
    select: () => ({
      eq: (col: string, val: any) => ({
        eq: (col2: string, val2: any) => ({
          order: () => ({
            limit: async () => {
              const rows = mockDbState[table].filter((r) => r[col] === val && r[col2] === val2)
              return { data: rows, error: null }
            },
          }),
        }),
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: async (col: string, val: any) => {
        const row = mockDbState[table].find((r) => r[col] === val)
        if (row) Object.assign(row, patch)
        return { data: row ? [row] : [], error: null }
      },
    }),
  }
}

vi.mock('../lib/supabase.js', () => ({
  createServiceClient: () => ({
    from: (table: string) => buildTableMock(table as keyof typeof mockDbState),
  }),
}))

const mockChainConfig = {
  horizonUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  assetCode: 'PHPC',
  issuerPublicKey: 'GBZFCMQFAKQTAC7THZMRGVBM5QXRDRFEJXT6XLBRIAAGIQCH5WGE2PW2',
  issuerSecret: 'SCZANGBA5YHTNYVVV3C7CAZMCLXPILIKVCELCY5GTTIY3STJZH5EQULLY',
  distributionSecret: 'SCZANGBA5YHTNYVVV3C7CAZMCLXPILIKVCELCY5GTTIY3STJZH5EQULLY',
  sponsorSecret: 'SCZANGBA5YHTNYVVV3C7CAZMCLXPILIKVCELCY5GTTIY3STJZH5EQULLY',
  keyEncryptionKey: 'test-key-encryption-key',
  qrTokenSecret: 'test-qr-token-secret',
  qrTokenTtlSeconds: 300,
}

vi.mock('../lib/chain/config.js', () => ({
  loadChainConfig: vi.fn().mockReturnValue(ok(mockChainConfig)),
}))

const mockHasAuthorizedTrustline = vi.fn()
const mockSettlePurchase = vi.fn()

vi.mock('../services/chain.client.js', () => ({
  StellarClient: {
    create: vi.fn().mockResolvedValue(
      ok({
        hasAuthorizedTrustline: (...args: unknown[]) => mockHasAuthorizedTrustline(...args),
        settlePurchase: (...args: unknown[]) => mockSettlePurchase(...args),
      }),
    ),
  },
}))

const mockWithDecryptedKey = vi.fn()

vi.mock('../services/custodial-wallet.service.js', () => ({
  CustodialWalletService: class {
    withDecryptedKey(...args: unknown[]) {
      return mockWithDecryptedKey(...args)
    }
  },
}))

vi.mock('../repositories/beneficiary-wallet.repository.js', () => ({
  BeneficiaryWalletRepository: class {},
}))

vi.mock('../repositories/merchant-wallet.repository.js', () => ({
  MerchantWalletRepository: class {
    async findBy(col: string, val: string) {
      return mockDbState.merchant_wallets.filter((r: any) => r[col] === val)
    }
  },
}))

const mockRestoreBeneficiaryBalance = vi.fn()

vi.mock('../services/transaction.service.js', () => ({
  TransactionService: class {
    restoreBeneficiaryBalance(...args: unknown[]) {
      return mockRestoreBeneficiaryBalance(...args)
    }
  },
}))

const { runReconciliation } = await import('./reconcile.js')

// Tests

beforeEach(() => {
  vi.clearAllMocks()
  resetMockDbState()
  mockRestoreBeneficiaryBalance.mockResolvedValue(ok(undefined))
})

describe('runReconciliation', () => {
  it('converts the JSONB string amountStroops to a real bigint before calling settlePurchase (regression: TypeError on string/bigint mix)', async () => {
    // This is the exact realistic shape Postgres JSONB produces: every field
    // is a JSON primitive, so `amountStroops` arrives as a STRING, never a
    // bigint. The old code passed this string straight into settlePurchase,
    // which internally does `stroops / STROOPS_PER_ASSET` — a bigint
    // operation — and throws `TypeError: Cannot mix BigInt and other types`.
    mockDbState.outbox.push({
      id: 'outbox-1',
      status: 'PENDING',
      kind: 'TRANSACTION_CHAIN_SUBMIT',
      attempts: 0,
      created_at: new Date().toISOString(),
      payload_jsonb: {
        transactionId: 'tx-1',
        beneficiaryId: 'ben-1',
        merchantId: 'merch-1',
        amountStroops: '500000000', // STRING, as JSONB always produces
        categoryTotals: { GRAINS: 50 },
        totalCreditDeducted: 50,
      },
    })
    mockDbState.merchant_wallets.push({ merchant_id: 'merch-1', address: 'GMERCHANTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' })
    mockHasAuthorizedTrustline.mockResolvedValue(ok(true))
    mockWithDecryptedKey.mockImplementation(async (_id: string, _role: string, _repo: unknown, callback: (kp: unknown) => unknown) => {
      const fakeKeypair = { publicKey: () => 'GBENADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', secret: () => 'SFAKESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }
      return ok(await callback(fakeKeypair))
    })
    mockSettlePurchase.mockResolvedValue(ok({ hash: 'stellarhash123', ledger: 99 }))

    const result = await runReconciliation()

    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)

    // The critical assertion: settlePurchase was called with a real bigint,
    // not the string that JSONB produced.
    expect(mockSettlePurchase).toHaveBeenCalledTimes(1)
    const callArg = mockSettlePurchase.mock.calls[0][0]
    expect(typeof callArg.amountStroops).toBe('bigint')
    expect(callArg.amountStroops).toBe(500000000n)

    // Outbox marked DONE (no transactions row seeded in this fixture, so
    // the transaction-table update is a no-op; the outbox status is the
    // observable confirmation here).
    const outboxRow = mockDbState.outbox.find((o) => o.id === 'outbox-1')
    expect(outboxRow.status).toBe('DONE')
  })

  it('pre-checks the merchant trustline before submitting and fails without calling settlePurchase when missing (risk R1)', async () => {
    mockDbState.outbox.push({
      id: 'outbox-2',
      status: 'PENDING',
      kind: 'TRANSACTION_CHAIN_SUBMIT',
      attempts: 0,
      created_at: new Date().toISOString(),
      payload_jsonb: {
        transactionId: 'tx-2',
        beneficiaryId: 'ben-2',
        merchantId: 'merch-2',
        amountStroops: '100000000',
        totalCreditDeducted: 10,
      },
    })
    mockDbState.merchant_wallets.push({ merchant_id: 'merch-2', address: 'GNOTRUSTLINEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' })
    mockHasAuthorizedTrustline.mockResolvedValue(ok(false))

    const result = await runReconciliation()

    expect(result.failed).toBe(1)
    expect(mockSettlePurchase).not.toHaveBeenCalled()

    const outboxRow = mockDbState.outbox.find((o) => o.id === 'outbox-2')
    expect(outboxRow.last_error).toContain('trustline')
  })

  it('restores the beneficiary balance via the compensator after 3 permanent failures, using totalCreditDeducted from the payload', async () => {
    mockDbState.outbox.push({
      id: 'outbox-3',
      status: 'PENDING',
      kind: 'TRANSACTION_CHAIN_SUBMIT',
      attempts: 2, // this run will be the 3rd attempt -> permanently failed
      created_at: new Date().toISOString(),
      payload_jsonb: {
        transactionId: 'tx-3',
        beneficiaryId: 'ben-3',
        merchantId: 'merch-3',
        amountStroops: '250000000',
        totalCreditDeducted: 25,
      },
    })
    mockDbState.merchant_wallets.push({ merchant_id: 'merch-3', address: 'GMERCH3XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' })
    mockHasAuthorizedTrustline.mockResolvedValue(ok(true))
    mockWithDecryptedKey.mockResolvedValue(err(new OnchainError('simulated permanent failure', 0)))

    const result = await runReconciliation()

    expect(result.failed).toBe(1)
    expect(mockRestoreBeneficiaryBalance).toHaveBeenCalledTimes(1)
    expect(mockRestoreBeneficiaryBalance).toHaveBeenCalledWith(
      'ben-3',
      25,
      expect.stringContaining('failed'),
    )

    const outboxRow = mockDbState.outbox.find((o) => o.id === 'outbox-3')
    expect(outboxRow.status).toBe('FAILED')
  })

  it('does NOT restore the balance when totalCreditDeducted is absent from the payload (guards against silent no-op)', async () => {
    mockDbState.outbox.push({
      id: 'outbox-4',
      status: 'PENDING',
      kind: 'TRANSACTION_CHAIN_SUBMIT',
      attempts: 2,
      created_at: new Date().toISOString(),
      payload_jsonb: {
        transactionId: 'tx-4',
        beneficiaryId: 'ben-4',
        merchantId: 'merch-4',
        amountStroops: '100000000',
        // totalCreditDeducted intentionally omitted
      },
    })
    mockDbState.merchant_wallets.push({ merchant_id: 'merch-4', address: 'GMERCH4XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' })
    mockHasAuthorizedTrustline.mockResolvedValue(ok(true))
    mockWithDecryptedKey.mockResolvedValue(err(new OnchainError('simulated permanent failure', 0)))

    await runReconciliation()

    expect(mockRestoreBeneficiaryBalance).not.toHaveBeenCalled()
  })
})
