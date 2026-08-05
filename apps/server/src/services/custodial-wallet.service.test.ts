import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import type { ChainConfig } from '../lib/chain/config.js'
import type { BeneficiaryWalletRepository } from '../repositories/beneficiary-wallet.repository.js'
import type { MerchantWalletRepository } from '../repositories/merchant-wallet.repository.js'
import { CustodialWalletService } from './custodial-wallet.service.js'
import { ok, err, OnchainError } from '../lib/errors.js'

// Fixtures

function buildConfig(overrides: Partial<ChainConfig> = {}): ChainConfig {
  return {
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
    ...overrides,
  }
}

function buildMockRepo(overrides: { findBy?: ReturnType<typeof vi.fn>; insert?: ReturnType<typeof vi.fn> } = {}) {
  const findByMock = overrides.findBy ?? vi.fn()
  const insertMock = overrides.insert ?? vi.fn()
  const mockRepo = { findBy: findByMock, insert: insertMock } as unknown as BeneficiaryWalletRepository
  return { mockRepo, findByMock, insertMock }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Tests

describe('CustodialWalletService.generateWallet', () => {
  it('treats wallet generation as failed after exactly 3 collision attempts, without inserting a row', async () => {
    const { mockRepo, findByMock, insertMock } = buildMockRepo({
      findBy: vi.fn().mockResolvedValue([{ address: 'GCOLLISIONADDRESSNOTREAL' }]),
    })

    const service = new CustodialWalletService(buildConfig())
    const result = await service.generateWallet('some-beneficiary-id', 'beneficiary', mockRepo)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.message).toContain('3 attempts')
    }
    expect(findByMock).toHaveBeenCalledTimes(3)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('succeeds on the first attempt and inserts exactly once when there is no collision', async () => {
    const { mockRepo, findByMock, insertMock } = buildMockRepo({
      findBy: vi.fn().mockResolvedValue([]),
    })

    const service = new CustodialWalletService(buildConfig())
    const result = await service.generateWallet('some-beneficiary-id', 'beneficiary', mockRepo)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      // Stellar public keys start with G and are 56 chars
      expect(result.value.address).toMatch(/^G[A-Z2-7]{55}$/)
    }
    expect(findByMock).toHaveBeenCalledTimes(1)
    expect(insertMock).toHaveBeenCalledTimes(1)
  })

  it('works for merchant role', async () => {
    const insertMock = vi.fn()
    const findByMock = vi.fn().mockResolvedValue([])
    const mockRepo = { findBy: findByMock, insert: insertMock } as unknown as MerchantWalletRepository

    const service = new CustodialWalletService(buildConfig())
    const result = await service.generateWallet('some-merchant-id', 'merchant', mockRepo)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.address).toMatch(/^G[A-Z2-7]{55}$/)
    }
    expect(insertMock).toHaveBeenCalledTimes(1)
    const row = insertMock.mock.calls[0][0]
    expect(row).toHaveProperty('merchant_id', 'some-merchant-id')
  })

  it('provisions the account on-chain when a chainClient is supplied and reports provisioned: true on success', async () => {
    const { mockRepo } = buildMockRepo({ findBy: vi.fn().mockResolvedValue([]) })
    const provisionAccountMock = vi.fn().mockResolvedValue(ok(undefined))
    const fakeChainClient = { provisionAccount: provisionAccountMock } as any

    const service = new CustodialWalletService(buildConfig())
    const result = await service.generateWallet('some-beneficiary-id', 'beneficiary', mockRepo, fakeChainClient)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.provisioned).toBe(true)
    }
    expect(provisionAccountMock).toHaveBeenCalledTimes(1)
    const callArg = provisionAccountMock.mock.calls[0][0]
    expect(callArg.accountId).toMatch(/^G[A-Z2-7]{55}$/)
    expect(typeof callArg.accountSecret).toBe('string')
  })

  it('does NOT fail wallet generation when on-chain provisioning fails; reports provisioned: false and still persists the DB row', async () => {
    const { mockRepo, insertMock } = buildMockRepo({ findBy: vi.fn().mockResolvedValue([]) })
    const provisionAccountMock = vi.fn().mockResolvedValue(err(new OnchainError('Horizon unreachable', 0)))
    const fakeChainClient = { provisionAccount: provisionAccountMock } as any

    const service = new CustodialWalletService(buildConfig())
    const result = await service.generateWallet('some-beneficiary-id', 'beneficiary', mockRepo, fakeChainClient)

    // The wallet row is already persisted by the time provisioning runs, so
    // a Horizon outage must not turn into a failed registration.
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.provisioned).toBe(false)
    }
    expect(insertMock).toHaveBeenCalledTimes(1)
  })

  it('reports provisioned: false when no chainClient is supplied at all (config-load failure upstream)', async () => {
    const { mockRepo } = buildMockRepo({ findBy: vi.fn().mockResolvedValue([]) })

    const service = new CustodialWalletService(buildConfig())
    const result = await service.generateWallet('some-beneficiary-id', 'beneficiary', mockRepo)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.provisioned).toBe(false)
    }
  })
})

// Property 9: Each entity maps to exactly one globally unique wallet
// address, with collision retry.

describe('Property 9: each beneficiary maps to exactly one globally unique wallet address, with collision retry', () => {
  it('retries up to 3 attempts on collision and succeeds once a unique address is found, or fails after exhausting all 3', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 3 }), async (collisionsBeforeUnique) => {
        let callCount = 0
        const findByMock = vi.fn().mockImplementation(async () => {
          callCount++
          return callCount <= collisionsBeforeUnique
            ? [{ address: 'GCOLLISIONADDRESS' }]
            : []
        })
        const insertMock = vi.fn().mockResolvedValue(undefined)
        const mockRepo = { findBy: findByMock, insert: insertMock } as unknown as BeneficiaryWalletRepository

        const service = new CustodialWalletService(buildConfig())
        const result = await service.generateWallet('beneficiary-x', 'beneficiary', mockRepo)

        if (collisionsBeforeUnique < 3) {
          expect(result.isOk()).toBe(true)
          expect(findByMock).toHaveBeenCalledTimes(collisionsBeforeUnique + 1)
          expect(insertMock).toHaveBeenCalledTimes(1)
        } else {
          expect(result.isErr()).toBe(true)
          expect(findByMock).toHaveBeenCalledTimes(3)
          expect(insertMock).not.toHaveBeenCalled()
        }
      }),
      { numRuns: 20 },
    )
  })
})

// Property 10: Private keys are persisted only in encrypted form.

describe('Property 10: beneficiary private keys are persisted only in encrypted form', () => {
  it('never persists the plaintext private key; only ciphertext/iv/authTag are inserted, and ciphertext differs from plaintext', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (beneficiaryId) => {
        const { mockRepo, insertMock } = buildMockRepo({ findBy: vi.fn().mockResolvedValue([]) })

        const service = new CustodialWalletService(buildConfig())
        const result = await service.generateWallet(beneficiaryId, 'beneficiary', mockRepo)
        expect(result.isOk()).toBe(true)

        expect(insertMock).toHaveBeenCalledTimes(1)
        const insertedRow = insertMock.mock.calls[0][0]
        expect(insertedRow).toHaveProperty('enc_ciphertext')
        expect(insertedRow).toHaveProperty('enc_iv')
        expect(insertedRow).toHaveProperty('enc_auth_tag')
        expect(insertedRow).not.toHaveProperty('privateKey')
        expect(insertedRow).not.toHaveProperty('private_key')
        expect(insertedRow).not.toHaveProperty('secretSeed')
        // The ciphertext must not equal a Stellar secret seed format
        expect(insertedRow.enc_ciphertext).not.toMatch(/^S[A-Z2-7]{55}$/)
      }),
      { numRuns: 30 },
    )
  })
})

// Property 11: Wallet key encryption/decryption round-trip enables signing.

describe('Property 11: wallet key encryption/decryption round-trip enables signing', () => {
  it('withDecryptedKey decrypts the stored key and produces a valid Keypair via callback', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (beneficiaryId) => {
        let storedRow: Record<string, unknown>
        const findByMock = vi.fn().mockImplementation(async (column: string) => {
          if (column === 'address') return []
          if (column === 'beneficiary_id') return storedRow ? [storedRow] : []
          return []
        })
        const insertMock = vi.fn().mockImplementation(async (row: Record<string, unknown>) => {
          storedRow = row
          return row
        })
        const mockRepo = { findBy: findByMock, insert: insertMock } as unknown as BeneficiaryWalletRepository

        const service = new CustodialWalletService(buildConfig())
        const genResult = await service.generateWallet(beneficiaryId, 'beneficiary', mockRepo)
        expect(genResult.isOk()).toBe(true)

        const keyResult = await service.withDecryptedKey(beneficiaryId, 'beneficiary', mockRepo, async (keypair) => {
          // The callback receives a Stellar Keypair; prove it matches the generated address
          return { publicKey: keypair.publicKey() }
        })

        expect(keyResult.isOk()).toBe(true)
        if (keyResult.isOk() && genResult.isOk()) {
          expect(keyResult.value.publicKey).toBe(genResult.value.address)
        }
      }),
      { numRuns: 20 },
    )
  })
})

// Property 12: Decrypted key material is erased after signing.

describe('Property 12: decrypted key material is erased after signing', () => {
  it('zeroizes the decrypted key buffer (via Buffer.prototype.fill(0)) whether callback succeeds or throws', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.boolean(), async (beneficiaryId, shouldThrow) => {
        let storedRow: Record<string, unknown>
        const findByMock = vi.fn().mockImplementation(async (column: string) => {
          if (column === 'address') return []
          if (column === 'beneficiary_id') return storedRow ? [storedRow] : []
          return []
        })
        const insertMock = vi.fn().mockImplementation(async (row: Record<string, unknown>) => {
          storedRow = row
          return row
        })
        const mockRepo = { findBy: findByMock, insert: insertMock } as unknown as BeneficiaryWalletRepository

        const service = new CustodialWalletService(buildConfig())
        await service.generateWallet(beneficiaryId, 'beneficiary', mockRepo)

        const fillSpy = vi.spyOn(Buffer.prototype, 'fill')

        const result = await service.withDecryptedKey(beneficiaryId, 'beneficiary', mockRepo, async (keypair) => {
          if (shouldThrow) {
            throw new Error('simulated callback failure')
          }
          return keypair.publicKey()
        })

        if (shouldThrow) {
          expect(result.isErr()).toBe(true)
        } else {
          expect(result.isOk()).toBe(true)
        }

        const zeroFillCalls = fillSpy.mock.calls.filter((args) => args[0] === 0)
        expect(zeroFillCalls.length).toBeGreaterThanOrEqual(1)

        fillSpy.mockRestore()

        // A second independent call must still work correctly
        const secondResult = await service.withDecryptedKey(beneficiaryId, 'beneficiary', mockRepo, async (keypair) => keypair.publicKey())
        expect(secondResult.isOk()).toBe(true)
      }),
      { numRuns: 20 },
    )
  })
})

// Property 13: Decryption failure aborts signing without exposing or
// mutating key material.

describe('Property 13: decryption failure aborts signing without exposing or mutating key material', () => {
  it('aborts and returns an error excluding key material when the stored ciphertext is corrupted', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (beneficiaryId) => {
        const corruptedRow = {
          enc_ciphertext: 'not-valid-base64-ciphertext!!!',
          enc_iv: Buffer.from('aaaaaaaaaaaa').toString('base64'),
          enc_auth_tag: Buffer.from('bbbbbbbbbbbbbbbb').toString('base64'),
        }
        const findByMock = vi.fn().mockResolvedValue([corruptedRow])
        const mockRepo = { findBy: findByMock, insert: vi.fn() } as unknown as BeneficiaryWalletRepository

        const service = new CustodialWalletService(buildConfig())
        let callbackCalled = false
        const result = await service.withDecryptedKey(beneficiaryId, 'beneficiary', mockRepo, async (_keypair) => {
          callbackCalled = true
          return 'should-not-reach'
        })

        expect(result.isErr()).toBe(true)
        expect(callbackCalled).toBe(false)
        if (result.isErr()) {
          expect(result.error.message).not.toContain(corruptedRow.enc_ciphertext)
        }
      }),
      { numRuns: 20 },
    )
  })
})
