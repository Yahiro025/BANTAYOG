/**
 * BlockchainClient — Polygon Amoy (chain ID 80002) read/write client.
 *
 * Per the polygon-amoy-phpc-migration design (Components and Interfaces §2)
 * and Migration Strategy step 2: this replaces the old Ronin Saigon /
 * local-Hardhat `ChainClient`. Every failure path returns a typed
 * `Err(OnchainError)` — there is NO "return mock on failure" fallback. A 30
 * second bound is enforced on connection/read/write via viem's `http`
 * transport `timeout` option, and on `waitForTransactionReceipt` via its own
 * `timeout` parameter.
 *
 * Requirements: 1.2, 1.3, 1.5, 1.6, 1.7, 1.8
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  keccak256,
  toBytes,
  type Account,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { type ChainConfig, POLYGON_AMOY_CHAIN_ID } from '../lib/chain/config.js'
import { type AppResult, OnchainError, ok, err } from '../lib/errors.js'

/** Bound (ms) enforced on connection setup, reads, writes, and confirmation waits. */
const OPERATION_TIMEOUT_MS = 30_000

const NETWORK_NAME = 'Polygon Amoy'
const BALANCE_CACHE_TTL_MS = 5_000

type CachedBalance = {
  value: bigint
  expiresAt: number
}

function sameClientConfig(left: ChainConfig, right: ChainConfig): boolean {
  return (
    left.rpcUrl === right.rpcUrl &&
    left.chainId === right.chainId &&
    left.deployerKey === right.deployerKey &&
    left.lguAdminWallet === right.lguAdminWallet &&
    left.phpcTokenAddress === right.phpcTokenAddress &&
    left.phpcSubsidyAddress === right.phpcSubsidyAddress
  )
}

export const PHPC_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  }
] as const

export const PHPC_SUBSIDY_ABI = [
  {
    inputs: [
      { name: 'beneficiaryId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'allocateCredits',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'beneficiaryId', type: 'bytes32' },
      { name: 'merchantAddress', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'transactionId', type: 'bytes32' }
    ],
    name: 'processTransaction',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'beneficiaryId', type: 'bytes32' }],
    name: 'getBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  }
] as const

/** A generic transaction request accepted by {@link BlockchainClient.signAndSend}. */
export interface TxRequest {
  to: `0x${string}`
  data?: Hex
  value?: bigint
}

type AmoyPublicClient = ReturnType<typeof createPublicClient>
type AmoyWalletClient = ReturnType<typeof createWalletClient>
type AmoyChain = ReturnType<typeof defineChain>

/** Extracts a numeric error code from an unknown thrown value, defaulting to 0. */
function toErrorCode(e: unknown): number {
  const code = (e as { code?: unknown } | null | undefined)?.code
  return typeof code === 'number' ? code : 0
}

export class BlockchainClient {
  private static cachedClient: { config: ChainConfig; client: BlockchainClient } | undefined
  private static inFlightCreation:
    | { config: ChainConfig; promise: Promise<AppResult<BlockchainClient>> }
    | undefined

  private readonly balanceCache = new Map<string, CachedBalance>()
  private readonly inFlightBalanceReads = new Map<string, Promise<AppResult<bigint>>>()

  private constructor(
    private readonly config: ChainConfig,
    private readonly chain: AmoyChain,
    private readonly publicClient: AmoyPublicClient,
    private readonly walletClient: AmoyWalletClient | undefined,
  ) {}

  /**
   * Builds a Polygon Amoy `viem` chain from `config.rpcUrl` and verifies the
   * connected network actually reports chain ID 80002 before constructing a
   * usable client. On a mismatch, or on any transport failure during the
   * check, no client is constructed — this method returns an error instead.
   *
   * Requirements: 1.2, 1.3, 1.5, 1.7, 1.8
   */
  static async create(config: ChainConfig): Promise<AppResult<BlockchainClient>> {
    const chain = defineChain({
      id: POLYGON_AMOY_CHAIN_ID,
      name: NETWORK_NAME,
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    })

    const publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl, { timeout: OPERATION_TIMEOUT_MS }),
    })

    let reportedChainId: number
    try {
      reportedChainId = await publicClient.getChainId()
    } catch {
      return err(new OnchainError(`Failed to connect to ${NETWORK_NAME}`, 0))
    }

    if (reportedChainId !== POLYGON_AMOY_CHAIN_ID) {
      return err(
        new OnchainError(
          `Chain ID mismatch: expected ${POLYGON_AMOY_CHAIN_ID}, got ${reportedChainId}`,
          reportedChainId,
        ),
      )
    }

    let walletClient: AmoyWalletClient | undefined
    if (config.deployerKey) {
      const account = privateKeyToAccount(config.deployerKey)
      walletClient = createWalletClient({
        account,
        chain,
        transport: http(config.rpcUrl, { timeout: OPERATION_TIMEOUT_MS }),
      })
    }

    return ok(new BlockchainClient(config, chain, publicClient, walletClient))
  }

  /**
   * Returns a validated client for the current process and coalesces concurrent
   * creation requests for the same configuration. A changed RPC or contract
   * configuration creates a new client instead of reusing stale state.
   */
  static async getOrCreate(config: ChainConfig): Promise<AppResult<BlockchainClient>> {
    const cached = this.cachedClient
    if (cached && sameClientConfig(cached.config, config)) {
      return ok(cached.client)
    }

    const inFlight = this.inFlightCreation
    if (inFlight && sameClientConfig(inFlight.config, config)) {
      return inFlight.promise
    }

    const promise = this.create(config)
    this.inFlightCreation = { config, promise }

    try {
      const result = await promise
      if (result.isOk() && this.inFlightCreation?.promise === promise) {
        this.cachedClient = { config, client: result.value }
      }
      return result
    } finally {
      if (this.inFlightCreation?.promise === promise) {
        this.inFlightCreation = undefined
      }
    }
  }

  /** Hashes a UUID string to a bytes32 identifier for Solidity contract calls. */
  private hashUuid(uuid: string): Hex {
    return keccak256(toBytes(uuid))
  }

  /**
   * Public accessor for the internal `viem` public client, for callers that
   * need direct read access (e.g. `getBlockNumber`/`getLogs` polling in the
   * on-chain event listener) beyond this class's own typed methods.
   *
   * Requirements: 1.6, 2.4, 2.5
   */
  getPublicClientRef(): AmoyPublicClient {
    return this.publicClient
  }

  /** Returns the configured `PHPCSubsidy` contract address. */
  getSubsidyContractAddress(): `0x${string}` {
    return this.config.phpcSubsidyAddress
  }

  /**
   * Public rename of {@link hashUuid}: hashes a beneficiary id string to the
   * bytes32 identifier used to correlate on-chain events with database rows.
   */
  hashBeneficiaryId(id: string): Hex {
    return this.hashUuid(id)
  }

  /**
   * Reads `PHPC.balanceOf(lguAdminWallet)`. No mock fallback on failure.
   *
   * Requirements: 1.6
   */
  async getTreasuryBalance(): Promise<AppResult<bigint>> {
    try {
      const balance = await this.publicClient.readContract({
        address: this.config.phpcTokenAddress,
        abi: PHPC_ABI,
        functionName: 'balanceOf',
        args: [this.config.lguAdminWallet],
      })
      return ok(balance)
    } catch (e) {
      return err(new OnchainError(`getTreasuryBalance failed on ${NETWORK_NAME}`, toErrorCode(e)))
    }
  }

  /**
   * Reads and briefly caches a successful PHPC balance. Concurrent reads for
   * the same address share one RPC request; failures are never cached.
   */
  async getCachedBalance(address: string): Promise<AppResult<bigint>> {
    const cacheKey = address.toLowerCase()
    const cached = this.balanceCache.get(cacheKey)

    if (cached && cached.expiresAt > Date.now()) {
      return ok(cached.value)
    }
    if (cached) {
      this.balanceCache.delete(cacheKey)
    }

    const inFlight = this.inFlightBalanceReads.get(cacheKey)
    if (inFlight) {
      return inFlight
    }

    const readPromise = this.getBalance(address)
    this.inFlightBalanceReads.set(cacheKey, readPromise)

    try {
      const result = await readPromise
      if (result.isOk()) {
        this.balanceCache.set(cacheKey, {
          value: result.value,
          expiresAt: Date.now() + BALANCE_CACHE_TTL_MS,
        })
      }
      return result
    } finally {
      if (this.inFlightBalanceReads.get(cacheKey) === readPromise) {
        this.inFlightBalanceReads.delete(cacheKey)
      }
    }
  }

  /**
   * Reads `PHPC.balanceOf(address)`. No mock fallback on failure.
   *
   * Requirements: 1.6
   */
  async getBalance(address: string): Promise<AppResult<bigint>> {
    try {
      const balance = await this.publicClient.readContract({
        address: this.config.phpcTokenAddress,
        abi: PHPC_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      })
      return ok(balance)
    } catch (e) {
      return err(new OnchainError(`getBalance failed on ${NETWORK_NAME}`, toErrorCode(e)))
    }
  }

  /**
   * Calls `PHPCSubsidy.allocateCredits(keccak256(beneficiaryId), amountWei)`.
   * Requires a wallet client (deployer key configured). No mock fallback on
   * failure.
   *
   * Requirements: 1.3, 1.6
   */
  async allocateCredits(beneficiaryId: string, amountWei: bigint): Promise<AppResult<Hex>> {
    if (!this.walletClient || !this.walletClient.account) {
      return err(new OnchainError('Wallet client not initialized: missing deployer key', 0))
    }
    try {
      // Get the current nonce to avoid RPC lag issues
      const nonce = await this.publicClient.getTransactionCount({ 
        address: this.walletClient.account.address 
      });

      console.log(`[allocateCredits] Initiating transfer for ${beneficiaryId} with nonce ${nonce}`);

      // 1. Transfer the required amount of PHPC from the LGU treasury to the Subsidy contract
      const transferHash = await this.walletClient.writeContract({
        address: this.config.phpcTokenAddress,
        abi: PHPC_ABI,
        functionName: 'transfer',
        args: [this.config.phpcSubsidyAddress, amountWei],
        account: this.walletClient.account,
        chain: this.chain,
        nonce: nonce,
        gas: 100000n, // Skip simulation
      }).catch(e => {
         console.error("TRANSFER ERROR:", e);
         throw e;
      });
      
      console.log(`[allocateCredits] Transfer broadcast: ${transferHash}, awaiting receipt...`);

      // Wait for the transfer to be confirmed before allocating
      const receipt = await this.publicClient.waitForTransactionReceipt({ 
        hash: transferHash, 
        timeout: OPERATION_TIMEOUT_MS 
      }).catch(e => {
         console.error("RECEIPT ERROR:", e);
         throw e;
      });

      if (receipt.status !== 'success') {
         console.error("TRANSFER REVERTED:", receipt);
         throw new Error("Transfer reverted on-chain");
      }

      console.log(`[allocateCredits] Transfer confirmed. Allocating credits with nonce ${nonce + 1}`);

      // 2. Allocate the credits in the Subsidy contract
      const idHash = this.hashUuid(beneficiaryId)
      const hash = await this.walletClient.writeContract({
        address: this.config.phpcSubsidyAddress,
        abi: PHPC_SUBSIDY_ABI,
        functionName: 'allocateCredits',
        args: [idHash, amountWei],
        account: this.walletClient.account,
        chain: this.chain,
        nonce: nonce + 1,
        gas: 150000n, // Skip simulation
      }).catch(e => {
         console.error("ALLOCATE ERROR:", e);
         throw e;
      });

      console.log(`[allocateCredits] Allocation broadcast: ${hash}`);

      return ok(hash)
    } catch (e: any) {
      console.error("CAUGHT ONCHAIN ERROR:", e);
      return err(new OnchainError(`allocateCredits failed on ${NETWORK_NAME}: ${e.message || 'Unknown Error'}`, toErrorCode(e)))
    }
  }

  /**
   * Calls `PHPC.transfer(to, amountWei)`. Requires a wallet client (deployer
   * key configured). No mock fallback on failure.
   *
   * Requirements: 1.3, 1.6
   */
  async transferPHPC(to: string, amountWei: bigint): Promise<AppResult<Hex>> {
    if (!this.walletClient || !this.walletClient.account) {
      return err(new OnchainError('Wallet client not initialized: missing deployer key', 0))
    }
    try {
      const hash = await this.walletClient.writeContract({
        address: this.config.phpcTokenAddress,
        abi: PHPC_ABI,
        functionName: 'transfer',
        args: [to as `0x${string}`, amountWei],
        account: this.walletClient.account,
        chain: this.chain,
      })
      return ok(hash)
    } catch (e) {
      return err(new OnchainError(`transferPHPC failed on ${NETWORK_NAME}`, toErrorCode(e)))
    }
  }

  /**
   * Generic passthrough for custodial signing: sends `tx` using a wallet
   * client constructed for the given `account`, bound to this instance's
   * chain/transport (30s timeout). No mock fallback on failure.
   *
   * Requirements: 1.6
   */
  async signAndSend(account: Account, tx: TxRequest): Promise<AppResult<Hex>> {
    try {
      const client = createWalletClient({
        account,
        chain: this.chain,
        transport: http(this.config.rpcUrl, { timeout: OPERATION_TIMEOUT_MS }),
      })
      const hash = await client.sendTransaction({
        account,
        chain: this.chain,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      })
      return ok(hash)
    } catch (e) {
      return err(new OnchainError(`signAndSend failed on ${NETWORK_NAME}`, toErrorCode(e)))
    }
  }

  /**
   * Waits for a transaction receipt, bounded by `timeoutMs` (default 30s).
   * No fake receipt fallback on timeout/failure.
   *
   * Requirements: 1.6
   */
  async waitForConfirmation(
    hash: Hex,
    timeoutMs: number = OPERATION_TIMEOUT_MS,
  ): Promise<AppResult<TransactionReceipt>> {
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs })
      return ok(receipt)
    } catch (e) {
      return err(
        new OnchainError(
          `Transaction confirmation failed or timed out on ${NETWORK_NAME}`,
          toErrorCode(e),
          hash,
        ),
      )
    }
  }
}
