import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OnchainError } from '../lib/errors.js'
import type { ChainConfig } from '../lib/chain/config.js'

// Stellar SDK mocking
//
// StellarClient.create() calls server.loadAccount() over real network
// transport. We mock @stellar/stellar-sdk so tests stay deterministic and
// never touch the network.

const loadAccountMock = vi.fn()
const submitTransactionMock = vi.fn()
const fetchBaseFeeMock = vi.fn()
const ledgersCallMock = vi.fn()

const mockLedgersBuilder = {
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  call: ledgersCallMock,
}

const mockServer = {
  loadAccount: loadAccountMock,
  submitTransaction: submitTransactionMock,
  fetchBaseFee: fetchBaseFeeMock,
  ledgers: vi.fn(() => mockLedgersBuilder),
}

vi.mock('@stellar/stellar-sdk', async () => {
  const actual = await vi.importActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk')
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: vi.fn(() => mockServer),
    },
  }
})

// Imported after mocks are registered
const { StellarClient } = await import('./chain.client.js')

// Fixtures

// Valid Stellar keypairs generated for testing only, no real funds.
const TEST_ISSUER_SECRET = 'SDCZZHZZD5SXM4D2URYUXP2P4SE2USDCY2LZDPZKJKYAU3D7IBDUYA7T'
const TEST_ISSUER_PUBLIC = 'GD6VMWR7LSJB7EUN3EFDWAPLFU4J4F6PPMYEARN3ZHLQQAAWMRHS6ITF'
const TEST_DISTRIBUTION_SECRET = 'SDC2BIDMEHKSREA3ERHZ6X6JHCREXA7M4VK3YZ6V2VLF7V34XLODJTPB'
const TEST_DISTRIBUTION_PUBLIC = 'GCMDPTWWUFBBRVXQRPAGERY56BU6L4G6FL62DIYBN6YJTTNTMM5HSYNT'
const TEST_SPONSOR_SECRET = 'SB2I3WPGIQZJQC4J5HZV5Y3ZMBEWQ2F7KY4KRV3BQPLI2RKHFGWS64FY'
const TEST_SPONSOR_PUBLIC = 'GDMWRPZ5XBKU2HZ5DDRLHFEZRBIV26Z5ZRFYT3TELC5LTDCFLRMQQI4N'

function buildConfig(overrides: Partial<ChainConfig> = {}): ChainConfig {
  return {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    assetCode: 'PHPC',
    issuerPublicKey: TEST_ISSUER_PUBLIC,
    issuerSecret: TEST_ISSUER_SECRET,
    distributionSecret: TEST_DISTRIBUTION_SECRET,
    sponsorSecret: TEST_SPONSOR_SECRET,
    keyEncryptionKey: 'test-key-encryption-key',
    qrTokenSecret: 'test-qr-token-secret',
    qrTokenTtlSeconds: 300,
    ...overrides,
  }
}

function makeAccountWithBalance(balanceStr: string, authorized = true) {
  return {
    accountId: () => TEST_DISTRIBUTION_PUBLIC,
    sequenceNumber: () => '12345',
    incrementSequenceNumber: vi.fn(),
    balances: [
      {
        asset_type: 'credit_alphanum4',
        asset_code: 'PHPC',
        asset_issuer: TEST_ISSUER_PUBLIC,
        balance: balanceStr,
        is_authorized: authorized,
        is_authorized_to_maintain_liabilities: false,
        is_clawback_enabled: true,
        limit: '1000000000',
      },
      {
        asset_type: 'native',
        balance: '100.0000000',
      },
    ],
  }
}

function makeAccountWithoutTrustline() {
  return {
    accountId: () => TEST_DISTRIBUTION_PUBLIC,
    sequenceNumber: () => '12345',
    incrementSequenceNumber: vi.fn(),
    balances: [
      {
        asset_type: 'native',
        balance: '100.0000000',
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchBaseFeeMock.mockResolvedValue('100')
})

// Tests

describe('StellarClient.create', () => {
  it('succeeds when the distribution account loads successfully', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))

    const result = await StellarClient.create(buildConfig())
    expect(result.isOk()).toBe(true)
  })

  it('returns err(OnchainError) when Horizon is unreachable, without throwing', async () => {
    loadAccountMock.mockRejectedValue(new Error('Network error'))

    const result = await StellarClient.create(buildConfig())
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(OnchainError)
      expect(result.error.message).toContain('Failed to connect to Stellar Horizon')
    }
  })
})

describe('StellarClient.getAssetBalance', () => {
  it('returns the correct bigint stroops for a known balance string with all 7 decimal places', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    // Now mock the specific account load for the balance query
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('123.4567890'))

    const balanceResult = await client.getAssetBalance(TEST_DISTRIBUTION_PUBLIC)
    expect(balanceResult.isOk()).toBe(true)
    // 123 * 10_000_000 + 4567890 = 1_234_567_890
    expect(balanceResult._unsafeUnwrap()).toBe(1_234_567_890n)
  })

  it('handles a balance with fewer than 7 decimal places', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    loadAccountMock.mockResolvedValue(makeAccountWithBalance('50.12'))

    const balanceResult = await client.getAssetBalance(TEST_DISTRIBUTION_PUBLIC)
    expect(balanceResult.isOk()).toBe(true)
    // 50 * 10_000_000 + 1200000 = 501_200_000
    expect(balanceResult._unsafeUnwrap()).toBe(501_200_000n)
  })

  it('handles a whole number balance with no decimal part', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))

    const balanceResult = await client.getAssetBalance(TEST_DISTRIBUTION_PUBLIC)
    expect(balanceResult.isOk()).toBe(true)
    expect(balanceResult._unsafeUnwrap()).toBe(50_000_000_000n)
  })

  it('returns ok(0n) when no trustline exists for the asset', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    loadAccountMock.mockResolvedValue(makeAccountWithoutTrustline())

    const balanceResult = await client.getAssetBalance(TEST_DISTRIBUTION_PUBLIC)
    expect(balanceResult.isOk()).toBe(true)
    expect(balanceResult._unsafeUnwrap()).toBe(0n)
  })

  it('returns err(OnchainError) when the account does not exist', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    loadAccountMock.mockRejectedValue(new Error('Account not found'))

    const balanceResult = await client.getAssetBalance('GNOTEXIST')
    expect(balanceResult.isErr()).toBe(true)
    if (balanceResult.isErr()) {
      expect(balanceResult.error).toBeInstanceOf(OnchainError)
      expect(balanceResult.error.message).toContain('getAssetBalance')
    }
  })
})

describe('StellarClient.hasAuthorizedTrustline', () => {
  it('returns true when the trustline exists and is authorized', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    loadAccountMock.mockResolvedValue(makeAccountWithBalance('100.0000000', true))

    const trustResult = await client.hasAuthorizedTrustline(TEST_DISTRIBUTION_PUBLIC)
    expect(trustResult.isOk()).toBe(true)
    expect(trustResult._unsafeUnwrap()).toBe(true)
  })

  it('returns false when the trustline exists but is not authorized', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    loadAccountMock.mockResolvedValue(makeAccountWithBalance('100.0000000', false))

    const trustResult = await client.hasAuthorizedTrustline(TEST_DISTRIBUTION_PUBLIC)
    expect(trustResult.isOk()).toBe(true)
    expect(trustResult._unsafeUnwrap()).toBe(false)
  })

  it('returns false when no trustline exists', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    loadAccountMock.mockResolvedValue(makeAccountWithoutTrustline())

    const trustResult = await client.hasAuthorizedTrustline(TEST_DISTRIBUTION_PUBLIC)
    expect(trustResult.isOk()).toBe(true)
    expect(trustResult._unsafeUnwrap()).toBe(false)
  })

  it('returns err(OnchainError) when the account does not exist', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    loadAccountMock.mockRejectedValue(new Error('Account not found'))

    const trustResult = await client.hasAuthorizedTrustline('GNOTEXIST')
    expect(trustResult.isErr()).toBe(true)
    if (trustResult.isErr()) {
      expect(trustResult.error).toBeInstanceOf(OnchainError)
      expect(trustResult.error.message).toContain('hasAuthorizedTrustline')
    }
  })
})

describe('StellarClient.allocateSubsidy', () => {
  it('submits 5000 for tier 1 and returns hash+ledger on success', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('50000.0000000'))
    submitTransactionMock.mockResolvedValue({ hash: 'abc123hash', ledger: 42 })

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    const allocResult = await client.allocateSubsidy(
      'beneficiary-uuid-1',
      TEST_DISTRIBUTION_PUBLIC,
      1,
    )

    expect(allocResult.isOk()).toBe(true)
    expect(allocResult._unsafeUnwrap()).toEqual({ hash: 'abc123hash', ledger: 42 })
    expect(submitTransactionMock).toHaveBeenCalled()
  })

  it('submits 3500 for tier 2 and returns hash+ledger on success', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('50000.0000000'))
    submitTransactionMock.mockResolvedValue({ hash: 'def456hash', ledger: 99 })

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    const allocResult = await client.allocateSubsidy(
      'beneficiary-uuid-2',
      TEST_DISTRIBUTION_PUBLIC,
      2,
    )

    expect(allocResult.isOk()).toBe(true)
    expect(allocResult._unsafeUnwrap()).toEqual({ hash: 'def456hash', ledger: 99 })
  })

  it('returns err(OnchainError) on submission failure, and the error does NOT contain the distribution secret', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('50000.0000000'))
    submitTransactionMock.mockRejectedValue(new Error('Transaction failed'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    const allocResult = await client.allocateSubsidy(
      'beneficiary-uuid-1',
      TEST_DISTRIBUTION_PUBLIC,
      1,
    )

    expect(allocResult.isErr()).toBe(true)
    if (allocResult.isErr()) {
      expect(allocResult.error).toBeInstanceOf(OnchainError)
      expect(allocResult.error.message).toContain('allocateSubsidy')
      expect(allocResult.error.message).toContain('beneficiary-uuid-1')
      expect(allocResult.error.message).not.toContain(TEST_DISTRIBUTION_SECRET)
    }
  })

  it('recovers on a subsequent call after a transport failure (no stuck state)', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('50000.0000000'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    // First call fails
    submitTransactionMock.mockRejectedValueOnce(new Error('Network timeout'))
    const failResult = await client.allocateSubsidy(
      'beneficiary-1',
      TEST_DISTRIBUTION_PUBLIC,
      1,
    )
    expect(failResult.isErr()).toBe(true)
    if (failResult.isErr()) {
      expect(failResult.error).toBeInstanceOf(OnchainError)
      expect(failResult.error.message).toContain('allocateSubsidy')
    }

    // Second call on the same client succeeds with no partial/stuck state
    submitTransactionMock.mockResolvedValueOnce({ hash: 'recovered_hash', ledger: 55 })
    const successResult = await client.allocateSubsidy(
      'beneficiary-2',
      TEST_DISTRIBUTION_PUBLIC,
      2,
    )
    expect(successResult.isOk()).toBe(true)
    expect(successResult._unsafeUnwrap()).toEqual({ hash: 'recovered_hash', ledger: 55 })
  })
})

describe('StellarClient.settlePurchase', () => {
  it('converts stroops back to the exact decimal string with no precision loss', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('50000.0000000'))
    submitTransactionMock.mockResolvedValue({ hash: 'settle_hash', ledger: 77 })

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    // 123.4567890 PHPC = 1_234_567_890 stroops
    const settleResult = await client.settlePurchase({
      beneficiaryAccountId: TEST_DISTRIBUTION_PUBLIC,
      beneficiarySecret: TEST_DISTRIBUTION_SECRET,
      merchantAccountId: TEST_SPONSOR_PUBLIC,
      amountStroops: 1_234_567_890n,
    })

    expect(settleResult.isOk()).toBe(true)
    expect(settleResult._unsafeUnwrap()).toEqual({ hash: 'settle_hash', ledger: 77 })
    expect(submitTransactionMock).toHaveBeenCalled()
  })

  it('returns err(OnchainError) on failure', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('50000.0000000'))
    submitTransactionMock.mockRejectedValue(new Error('Submit failed'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    const settleResult = await client.settlePurchase({
      beneficiaryAccountId: TEST_DISTRIBUTION_PUBLIC,
      beneficiarySecret: TEST_DISTRIBUTION_SECRET,
      merchantAccountId: TEST_SPONSOR_PUBLIC,
      amountStroops: 500_000_000n,
    })

    expect(settleResult.isErr()).toBe(true)
    if (settleResult.isErr()) {
      expect(settleResult.error).toBeInstanceOf(OnchainError)
      expect(settleResult.error.message).toContain('settlePurchase')
    }
  })
})

describe('StellarClient.getLedgerSequence', () => {
  it('returns the latest ledger sequence number', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))
    ledgersCallMock.mockResolvedValue({
      records: [{ sequence: 12345 }],
    })

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    const ledgerResult = await client.getLedgerSequence()
    expect(ledgerResult.isOk()).toBe(true)
    expect(ledgerResult._unsafeUnwrap()).toBe(12345)
  })

  it('returns err(OnchainError) on failure', async () => {
    loadAccountMock.mockResolvedValue(makeAccountWithBalance('5000.0000000'))
    ledgersCallMock.mockRejectedValue(new Error('Network error'))

    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    const ledgerResult = await client.getLedgerSequence()
    expect(ledgerResult.isErr()).toBe(true)
    if (ledgerResult.isErr()) {
      expect(ledgerResult.error).toBeInstanceOf(OnchainError)
      expect(ledgerResult.error.message).toContain('getLedgerSequence')
    }
  })
})

// StellarClient.provisionAccount
//
// Covers Phase 3's core exit criterion: a generated custodial keypair gets
// an actual on-chain account, trustline, and authorization, not just a
// Postgres row. Every branch checks current on-chain state before
// submitting (idempotency, risk R2), matching the pattern already used by
// scripts/bootstrap-stellar.ts and scripts/provision-stellar-accounts.ts.

const TEST_NEW_ACCOUNT_SECRET = 'SBHXE3S4SNS4R2QT2A4PJWB5EN62HKJWEIDYGWDGTY5NCW7QE6LSJ6MN'
const TEST_NEW_ACCOUNT_PUBLIC = 'GANQ4X5FDIREJPH6LR5YCC5ODMSACA5T6Q54F7EF6BGO55M7R6AQIP52'

function makeFreshAccount(publicKey: string) {
  return {
    accountId: () => publicKey,
    sequenceNumber: () => '1',
    incrementSequenceNumber: vi.fn(),
    balances: [{ asset_type: 'native', balance: '0.0000000' }],
  }
}

function makeAccountWithTrustline(publicKey: string, authorized: boolean) {
  return {
    accountId: () => publicKey,
    sequenceNumber: () => '2',
    incrementSequenceNumber: vi.fn(),
    balances: [
      {
        asset_type: 'credit_alphanum4',
        asset_code: 'PHPC',
        asset_issuer: TEST_ISSUER_PUBLIC,
        balance: '0.0000000',
        is_authorized: authorized,
        limit: '50000',
      },
      { asset_type: 'native', balance: '1.0000000' },
    ],
  }
}

describe('StellarClient.provisionAccount', () => {
  beforeEach(() => {
    loadAccountMock.mockReset()
    submitTransactionMock.mockReset()
  })

  it('creates the account, trustline, and authorization for a brand-new address (no on-chain state at all)', async () => {
    // create() itself loads the distribution account first.
    loadAccountMock.mockResolvedValueOnce(makeAccountWithBalance('50000.0000000'))
    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    // Sequence of loadAccount calls inside provisionAccount:
    // 1. check account exists -> reject (404-like) to simulate "does not exist"
    // 2. sponsor account load for createAccount tx
    // 3. reload the now-created account to check the trustline -> no trustline
    // 4. sponsor account load for changeTrust tx
    loadAccountMock
      .mockRejectedValueOnce(new Error('Account not found'))
      .mockResolvedValueOnce(makeAccountWithBalance('50000.0000000')) // sponsor, for createAccount
      .mockResolvedValueOnce(makeFreshAccount(TEST_NEW_ACCOUNT_PUBLIC)) // reload after create, no trustline
      .mockResolvedValueOnce(makeAccountWithBalance('50000.0000000')) // sponsor, for changeTrust
      .mockResolvedValueOnce(makeAccountWithBalance('50000.0000000')) // issuer, for setTrustLineFlags

    submitTransactionMock.mockResolvedValue({ hash: 'provision-hash', ledger: 7 })

    const provisionResult = await client.provisionAccount({
      accountId: TEST_NEW_ACCOUNT_PUBLIC,
      accountSecret: TEST_NEW_ACCOUNT_SECRET,
    })

    expect(provisionResult.isOk()).toBe(true)
    // 3 transactions submitted: createAccount, changeTrust, setTrustLineFlags
    expect(submitTransactionMock).toHaveBeenCalledTimes(3)
  })

  it('is idempotent: submits nothing when the account already exists with an authorized trustline', async () => {
    loadAccountMock.mockResolvedValueOnce(makeAccountWithBalance('50000.0000000'))
    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    // Account exists AND has an authorized trustline on the very first check.
    loadAccountMock.mockResolvedValue(makeAccountWithTrustline(TEST_NEW_ACCOUNT_PUBLIC, true))

    const provisionResult = await client.provisionAccount({
      accountId: TEST_NEW_ACCOUNT_PUBLIC,
      accountSecret: TEST_NEW_ACCOUNT_SECRET,
    })

    expect(provisionResult.isOk()).toBe(true)
    expect(submitTransactionMock).not.toHaveBeenCalled()
  })

  it('resumes correctly when the account exists but the trustline is missing', async () => {
    loadAccountMock.mockResolvedValueOnce(makeAccountWithBalance('50000.0000000'))
    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    loadAccountMock
      .mockResolvedValueOnce(makeFreshAccount(TEST_NEW_ACCOUNT_PUBLIC)) // account exists check -> exists
      .mockResolvedValueOnce(makeFreshAccount(TEST_NEW_ACCOUNT_PUBLIC)) // reload to check trustline -> none
      .mockResolvedValueOnce(makeAccountWithBalance('50000.0000000')) // sponsor, for changeTrust
      .mockResolvedValueOnce(makeAccountWithBalance('50000.0000000')) // issuer, for setTrustLineFlags

    submitTransactionMock.mockResolvedValue({ hash: 'resume-hash', ledger: 8 })

    const provisionResult = await client.provisionAccount({
      accountId: TEST_NEW_ACCOUNT_PUBLIC,
      accountSecret: TEST_NEW_ACCOUNT_SECRET,
    })

    expect(provisionResult.isOk()).toBe(true)
    // Only 2 transactions: changeTrust + setTrustLineFlags (no createAccount)
    expect(submitTransactionMock).toHaveBeenCalledTimes(2)
  })

  it('resumes correctly when the trustline exists but is not yet authorized', async () => {
    loadAccountMock.mockResolvedValueOnce(makeAccountWithBalance('50000.0000000'))
    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    loadAccountMock
      .mockResolvedValueOnce(makeAccountWithTrustline(TEST_NEW_ACCOUNT_PUBLIC, false)) // account exists check
      .mockResolvedValueOnce(makeAccountWithTrustline(TEST_NEW_ACCOUNT_PUBLIC, false)) // reload to check trustline -> unauthorized
      .mockResolvedValueOnce(makeAccountWithBalance('50000.0000000')) // issuer, for setTrustLineFlags

    submitTransactionMock.mockResolvedValue({ hash: 'auth-hash', ledger: 9 })

    const provisionResult = await client.provisionAccount({
      accountId: TEST_NEW_ACCOUNT_PUBLIC,
      accountSecret: TEST_NEW_ACCOUNT_SECRET,
    })

    expect(provisionResult.isOk()).toBe(true)
    // Only 1 transaction: setTrustLineFlags (no createAccount, no changeTrust)
    expect(submitTransactionMock).toHaveBeenCalledTimes(1)
  })

  it('returns err(OnchainError) and does not leak the account secret when submission fails', async () => {
    loadAccountMock.mockResolvedValueOnce(makeAccountWithBalance('50000.0000000'))
    const result = await StellarClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    loadAccountMock
      .mockRejectedValueOnce(new Error('Account not found'))
      .mockResolvedValueOnce(makeAccountWithBalance('50000.0000000'))
    submitTransactionMock.mockRejectedValue(new Error('tx submission failed'))

    const provisionResult = await client.provisionAccount({
      accountId: TEST_NEW_ACCOUNT_PUBLIC,
      accountSecret: TEST_NEW_ACCOUNT_SECRET,
    })

    expect(provisionResult.isErr()).toBe(true)
    if (provisionResult.isErr()) {
      expect(provisionResult.error).toBeInstanceOf(OnchainError)
      expect(provisionResult.error.message).not.toContain(TEST_NEW_ACCOUNT_SECRET)
    }
  })
})
