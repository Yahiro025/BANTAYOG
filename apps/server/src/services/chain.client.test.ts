import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import type { Hex } from 'viem'
import { OnchainError } from '../lib/errors.js'
import type { ChainConfig } from '../lib/chain/config.js'

// ---------------------------------------------------------------------------
// viem mocking
//
// BlockchainClient.create() calls publicClient.getChainId() over real
// network transport. We mock viem's createPublicClient/createWalletClient so
// tests stay deterministic and never touch the network, while keeping every
// other viem export (defineChain, keccak256, toBytes, http) real.
// ---------------------------------------------------------------------------
const { getChainIdMock, readContractMock, writeContractMock, getTransactionCountMock, createPublicClientMock, createWalletClientMock } =
  vi.hoisted(() => {
    return {
      getChainIdMock: vi.fn(),
      readContractMock: vi.fn(),
      writeContractMock: vi.fn(),
      getTransactionCountMock: vi.fn(),
      createPublicClientMock: vi.fn(),
      createWalletClientMock: vi.fn(),
    }
  })

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
    createWalletClient: createWalletClientMock,
  }
})

createPublicClientMock.mockImplementation(() => ({
  getChainId: getChainIdMock,
  readContract: readContractMock,
  getTransactionCount: getTransactionCountMock,
  waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
}))

createWalletClientMock.mockImplementation((args: { account?: unknown }) => ({
  account: args.account,
  writeContract: writeContractMock,
  sendTransaction: vi.fn(),
}))

// Imported after the mock is registered so BlockchainClient picks up the
// mocked viem client factories.
const { BlockchainClient } = await import('./chain.client.js')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Well-known Hardhat default test account #0 private key — public test
// vector, no real funds, used only to exercise privateKeyToAccount().
const TEST_DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

const LGU_ADMIN_WALLET = '0x1234567890123456789012345678901234567890' as const
const PHPC_TOKEN_ADDRESS = '0xABCDEF0123456789ABCDEF0123456789ABCDEF01' as const
const PHPC_SUBSIDY_ADDRESS = '0x9876543210987654321098765432109876543210' as const
const ARBITRARY_ADDRESS = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const

function buildConfig(overrides: Partial<ChainConfig> = {}): ChainConfig {
  return {
    rpcUrl: 'https://rpc-amoy.example.com',
    chainId: 80002,
    deployerKey: TEST_DEPLOYER_KEY,
    lguAdminWallet: LGU_ADMIN_WALLET,
    phpcTokenAddress: PHPC_TOKEN_ADDRESS,
    phpcSubsidyAddress: PHPC_SUBSIDY_ADDRESS,
    keyEncryptionKey: 'test-key-encryption-key',
    qrTokenSecret: 'test-qr-token-secret',
    qrTokenTtlSeconds: 300,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getTransactionCountMock.mockResolvedValue(0)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlockchainClient.create', () => {
  it('constructs a wallet client when a deployer key is present', async () => {
    getChainIdMock.mockResolvedValue(80002)
    writeContractMock.mockResolvedValue('0xhash1')

    const result = await BlockchainClient.create(buildConfig())
    expect(result.isOk()).toBe(true)
    const client = result._unsafeUnwrap()

    const writeResult = await client.allocateCredits('beneficiary-1', 100n)

    // The wallet client was actually constructed (writeContract got called),
    // proving the "deployer key present" path built a usable wallet client
    // rather than short-circuiting on "missing deployer key".
    expect(writeContractMock).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'allocateCredits' }),
    )
    expect(writeResult.isOk()).toBe(true)
    if (writeResult.isErr()) {
      expect(writeResult.error.message).not.toContain('missing deployer key')
    }
  })

  it('does not construct a wallet client when the deployer key is absent', async () => {
    getChainIdMock.mockResolvedValue(80002)

    const config = buildConfig({ deployerKey: '' as `0x${string}` })
    const result = await BlockchainClient.create(config)
    expect(result.isOk()).toBe(true)
    const client = result._unsafeUnwrap()

    const writeResult = await client.allocateCredits('beneficiary-1', 100n)

    expect(writeContractMock).not.toHaveBeenCalled()
    expect(writeResult.isErr()).toBe(true)
    if (writeResult.isErr()) {
      expect(writeResult.error).toBeInstanceOf(OnchainError)
      expect(writeResult.error.message).toContain('missing deployer key')
    }
  })

  it('returns an error naming the mismatched chain ID', async () => {
    getChainIdMock.mockResolvedValue(1)

    const result = await BlockchainClient.create(buildConfig())
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(OnchainError)
      expect(result.error.message).toContain('80002')
      expect(result.error.message).toContain('1')
    }
  })
})

describe('BlockchainClient.getOrCreate', () => {
  it('coalesces concurrent creation and reuses the validated client', async () => {
    let resolveChainId: (value: number | PromiseLike<number>) => void = () => undefined
    const chainIdPromise = new Promise<number>((resolve) => {
      resolveChainId = resolve
    })
    getChainIdMock.mockReturnValueOnce(chainIdPromise)

    const config = buildConfig({ rpcUrl: 'https://rpc-amoy-cache.example.com' })
    const firstPromise = BlockchainClient.getOrCreate(config)
    const secondPromise = BlockchainClient.getOrCreate(config)
    resolveChainId(80002)

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise])

    expect(firstResult.isOk()).toBe(true)
    expect(secondResult.isOk()).toBe(true)
    expect(createPublicClientMock).toHaveBeenCalledTimes(1)
    expect(getChainIdMock).toHaveBeenCalledTimes(1)

    const firstClient = firstResult._unsafeUnwrap()
    const secondClient = secondResult._unsafeUnwrap()
    expect(secondClient).toBe(firstClient)

    const cachedResult = await BlockchainClient.getOrCreate(config)
    expect(cachedResult.isOk()).toBe(true)
    expect(cachedResult._unsafeUnwrap()).toBe(firstClient)
    expect(getChainIdMock).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Property 3: Connected-network chain-ID verification.
// Feature: polygon-amoy-phpc-migration, Property 3: Connected-network
// chain-ID verification
// Validates: Requirements 1.7
// ---------------------------------------------------------------------------

describe('Property 3: connected-network chain-ID verification', () => {
  it('succeeds only when the reported chain ID is exactly 80002, otherwise errors naming the mismatch', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 999_999 }), async (reportedChainId) => {
        getChainIdMock.mockResolvedValue(reportedChainId)

        const result = await BlockchainClient.create(buildConfig())

        if (reportedChainId === 80002) {
          expect(result.isOk()).toBe(true)
        } else {
          expect(result.isErr()).toBe(true)
          if (result.isErr()) {
            expect(result.error).toBeInstanceOf(OnchainError)
            expect(result.error.message).toContain('80002')
            expect(result.error.message).toContain(String(reportedChainId))
          }
        }
      }),
      { numRuns: 100 },
    )
  })
})

describe('BlockchainClient.getTreasuryBalance', () => {
  it('reads PHPC.balanceOf(lguAdminWallet)', async () => {
    getChainIdMock.mockResolvedValue(80002)
    const expectedBalance = 100000n * 10n ** 18n
    readContractMock.mockResolvedValue(expectedBalance)

    const config = buildConfig()
    const result = await BlockchainClient.create(config)
    const client = result._unsafeUnwrap()

    const balanceResult = await client.getTreasuryBalance()

    expect(readContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: config.phpcTokenAddress,
        functionName: 'balanceOf',
        args: [config.lguAdminWallet],
      }),
    )
    expect(balanceResult.isOk()).toBe(true)
    expect(balanceResult._unsafeUnwrap()).toBe(expectedBalance)
  })
})

describe('BlockchainClient.getBalance', () => {
  it('reads PHPC.balanceOf for an arbitrary address, not the LGU admin wallet', async () => {
    getChainIdMock.mockResolvedValue(80002)
    const expectedBalance = 555n * 10n ** 18n
    readContractMock.mockResolvedValue(expectedBalance)

    const config = buildConfig()
    const result = await BlockchainClient.create(config)
    const client = result._unsafeUnwrap()

    const balanceResult = await client.getBalance(ARBITRARY_ADDRESS)

    expect(readContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: config.phpcTokenAddress,
        functionName: 'balanceOf',
        args: [ARBITRARY_ADDRESS],
      }),
    )
    // Proves the address is parameterized, not hardcoded to lguAdminWallet.
    expect(ARBITRARY_ADDRESS).not.toBe(config.lguAdminWallet)
    expect(balanceResult.isOk()).toBe(true)
    expect(balanceResult._unsafeUnwrap()).toBe(expectedBalance)
  })
})

describe('BlockchainClient.getCachedBalance', () => {
  it('coalesces concurrent reads and caches successful balances briefly', async () => {
    vi.useFakeTimers()

    try {
      getChainIdMock.mockResolvedValue(80002)
      const expectedBalance = 555n * 10n ** 18n
      let resolveRead: (value: bigint | PromiseLike<bigint>) => void = () => undefined
      const readPromise = new Promise<bigint>((resolve) => {
        resolveRead = resolve
      })
      readContractMock.mockReturnValueOnce(readPromise)

      const result = await BlockchainClient.create(buildConfig())
      const client = result._unsafeUnwrap()
      const firstRead = client.getCachedBalance(ARBITRARY_ADDRESS)
      const secondRead = client.getCachedBalance(ARBITRARY_ADDRESS)

      expect(readContractMock).toHaveBeenCalledTimes(1)
      resolveRead(expectedBalance)

      const [firstResult, secondResult] = await Promise.all([firstRead, secondRead])
      expect(firstResult.isOk()).toBe(true)
      expect(secondResult.isOk()).toBe(true)
      expect(firstResult._unsafeUnwrap()).toBe(expectedBalance)
      expect(secondResult._unsafeUnwrap()).toBe(expectedBalance)

      const cachedResult = await client.getCachedBalance(ARBITRARY_ADDRESS)
      expect(cachedResult.isOk()).toBe(true)
      expect(cachedResult._unsafeUnwrap()).toBe(expectedBalance)
      expect(readContractMock).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(5_001)
      const refreshedBalance = 777n * 10n ** 18n
      readContractMock.mockResolvedValueOnce(refreshedBalance)
      const refreshedResult = await client.getCachedBalance(ARBITRARY_ADDRESS)

      expect(refreshedResult.isOk()).toBe(true)
      expect(refreshedResult._unsafeUnwrap()).toBe(refreshedBalance)
      expect(readContractMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not cache a failed read, so the next call can recover', async () => {
    getChainIdMock.mockResolvedValue(80002)
    readContractMock
      .mockRejectedValueOnce(new Error('temporary RPC failure'))
      .mockResolvedValueOnce(123n)

    const result = await BlockchainClient.create(buildConfig())
    const client = result._unsafeUnwrap()

    const failedResult = await client.getCachedBalance(ARBITRARY_ADDRESS)
    const recoveredResult = await client.getCachedBalance(ARBITRARY_ADDRESS)

    expect(failedResult.isErr()).toBe(true)
    expect(recoveredResult.isOk()).toBe(true)
    expect(recoveredResult._unsafeUnwrap()).toBe(123n)
    expect(readContractMock).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Property 4: Chain operation failures propagate as typed errors with no
// state change.
// Feature: polygon-amoy-phpc-migration, Property 4: Chain operation failures
// propagate as typed errors with no state change
// Validates: Requirements 1.6
// ---------------------------------------------------------------------------

describe('Property 4: chain operation failures propagate as typed errors with no state change', () => {
  it('getTreasuryBalance/getBalance return an OnchainError identifying the operation and network on transport failure, without leaving partial state', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 50 }), async (errorMessage) => {
        getChainIdMock.mockResolvedValue(80002)
        readContractMock.mockRejectedValue(new Error(errorMessage))

        const result = await BlockchainClient.create(buildConfig())
        const client = result._unsafeUnwrap()

        const balanceResult = await client.getTreasuryBalance()
        expect(balanceResult.isErr()).toBe(true)
        if (balanceResult.isErr()) {
          expect(balanceResult.error).toBeInstanceOf(OnchainError)
          expect(balanceResult.error.message).toContain('getTreasuryBalance')
          expect(balanceResult.error.message).toContain('Polygon Amoy')
        }

        const arbitraryBalanceResult = await client.getBalance(ARBITRARY_ADDRESS)
        expect(arbitraryBalanceResult.isErr()).toBe(true)
        if (arbitraryBalanceResult.isErr()) {
          expect(arbitraryBalanceResult.error).toBeInstanceOf(OnchainError)
          expect(arbitraryBalanceResult.error.message).toContain('getBalance')
          expect(arbitraryBalanceResult.error.message).toContain('Polygon Amoy')
        }

        // No lingering partial/broken state: once the transport recovers,
        // the very next call on the same client instance succeeds cleanly
        // rather than replaying or being tainted by the prior failure.
        readContractMock.mockResolvedValueOnce(123n)
        const recoveredResult = await client.getTreasuryBalance()
        expect(recoveredResult.isOk()).toBe(true)
        expect(recoveredResult._unsafeUnwrap()).toBe(123n)
      }),
      { numRuns: 100 },
    )
  })

  it('allocateCredits/transferPHPC return an OnchainError identifying the operation and network on transport failure, without leaving partial state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        async (errorMessage, amount) => {
          getChainIdMock.mockResolvedValue(80002)
          writeContractMock.mockRejectedValue(new Error(errorMessage))

          const result = await BlockchainClient.create(buildConfig())
          const client = result._unsafeUnwrap()

          const allocResult = await client.allocateCredits('some-beneficiary', amount)
          expect(allocResult.isErr()).toBe(true)
          if (allocResult.isErr()) {
            expect(allocResult.error).toBeInstanceOf(OnchainError)
            expect(allocResult.error.message).toContain('allocateCredits')
            expect(allocResult.error.message).toContain('Polygon Amoy')
          }

          const transferResult = await client.transferPHPC(ARBITRARY_ADDRESS, amount)
          expect(transferResult.isErr()).toBe(true)
          if (transferResult.isErr()) {
            expect(transferResult.error).toBeInstanceOf(OnchainError)
            expect(transferResult.error.message).toContain('transferPHPC')
            expect(transferResult.error.message).toContain('Polygon Amoy')
          }

          // No lingering partial/broken state: once the transport recovers,
          // the very next write call on the same client instance succeeds
          // cleanly rather than replaying or being tainted by the prior
          // failure.
          writeContractMock.mockResolvedValue('0xrecovered' as Hex)
          const recoveredResult = await client.allocateCredits('some-beneficiary', amount)
          expect(recoveredResult.isOk()).toBe(true)
          expect(recoveredResult._unsafeUnwrap()).toBe('0xrecovered')
        },
      ),
      { numRuns: 100 },
    )
  })

  it('waitForConfirmation returns an OnchainError identifying the network and tx hash on transport failure, without leaving partial state', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 50 }), async (errorMessage) => {
        getChainIdMock.mockResolvedValue(80002)
        const waitForTransactionReceiptMock = vi.fn().mockRejectedValue(new Error(errorMessage))
        createPublicClientMock.mockImplementationOnce(() => ({
          getChainId: getChainIdMock,
          readContract: readContractMock,
          waitForTransactionReceipt: waitForTransactionReceiptMock,
        }))

        const result = await BlockchainClient.create(buildConfig())
        const client = result._unsafeUnwrap()

        const txHash = '0xabc123' as Hex
        const confirmResult = await client.waitForConfirmation(txHash)
        expect(confirmResult.isErr()).toBe(true)
        if (confirmResult.isErr()) {
          expect(confirmResult.error).toBeInstanceOf(OnchainError)
          expect(confirmResult.error.message).toContain('Polygon Amoy')
          expect(confirmResult.error.txHash).toBe(txHash)
        }

        // No lingering partial/broken state: once the transport recovers,
        // the very next confirmation wait on the same client instance
        // succeeds cleanly.
        waitForTransactionReceiptMock.mockResolvedValueOnce({ status: 'success' })
        const recoveredResult = await client.waitForConfirmation(txHash)
        expect(recoveredResult.isOk()).toBe(true)
      }),
      { numRuns: 100 },
    )
  })
})
