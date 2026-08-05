// StellarClient — Stellar Horizon read/write client for PHPC operations.
// Every failure path returns a typed `Err(OnchainError)` — there is NO
// "return mock on failure" fallback. Intent-shaped methods (F2): callers
// express what they want, not which Stellar operation to run.
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import type { ChainConfig } from '../lib/chain/config.js'
import { type AppResult, OnchainError, ok, err } from '../lib/errors.js'

// Timeout for Stellar transaction submission (seconds).
const TRANSACTION_TIMEOUT_SECONDS = 180

// 1 PHPC = 10,000,000 stroops (7 decimal places).
const STROOPS_PER_ASSET = 10_000_000n

// Tier-to-amount mapping: tier 1 = 5000 PHPC, tier 2 = 3500 PHPC.
const TIER_AMOUNTS: Record<1 | 2, number> = { 1: 5000, 2: 3500 }

type HorizonServer = InstanceType<typeof Horizon.Server>

// Parses a Stellar balance string (up to 7 decimal places) into exact
// bigint stroops with no floating-point intermediate.
function balanceToStroops(balance: string): bigint {
  const [whole, fraction = ''] = balance.split('.')
  const padded = fraction.padEnd(7, '0').slice(0, 7)
  return BigInt(whole) * STROOPS_PER_ASSET + BigInt(padded)
}

// Converts bigint stroops back to a decimal string with 7 decimal places.
// Exported for callers that read a raw stroops balance (e.g.
// `getAssetBalance`) and need to render it without floating-point loss.
export function stroopsToDecimal(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_ASSET
  const fraction = (stroops % STROOPS_PER_ASSET).toString().padStart(7, '0')
  return `${whole}.${fraction}`
}

export class StellarClient {
  private constructor(
    private readonly config: ChainConfig,
    private readonly server: HorizonServer,
    private readonly asset: Asset,
  ) {}

  // Constructs a Stellar Horizon client and verifies connectivity by loading
// the distribution account. On failure returns an error rather than throwing.
  static async create(config: ChainConfig): Promise<AppResult<StellarClient>> {
    const server = new Horizon.Server(config.horizonUrl)
    const asset = new Asset(config.assetCode, config.issuerPublicKey)

    try {
      const distPubKey = Keypair.fromSecret(config.distributionSecret).publicKey()
      await server.loadAccount(distPubKey)
    } catch {
      return err(new OnchainError('Failed to connect to Stellar Horizon', 0))
    }

    return ok(new StellarClient(config, server, asset))
  }

  // Reads the PHPC balance for an account, returned as exact bigint stroops.
// Returns ok(0n) if the account has no trustline for the asset.
// Returns err if the account itself does not exist on Horizon.
  async getAssetBalance(accountId: string): Promise<AppResult<bigint>> {
    try {
      const account = await this.server.loadAccount(accountId)
      const entry = account.balances.find(
        (b: any) =>
          'asset_code' in b &&
          b.asset_code === this.config.assetCode &&
          b.asset_issuer === this.config.issuerPublicKey,
      )
      if (!entry) return ok(0n)
      return ok(balanceToStroops((entry as any).balance))
    } catch {
      return err(new OnchainError('getAssetBalance failed on Stellar', 0))
    }
  }

  // Checks whether an account has an authorized trustline for the PHPC asset.
// Returns ok(false) if trustline doesn't exist or isn't authorized.
// Returns err only on connectivity/account-not-found failure.
  async hasAuthorizedTrustline(accountId: string): Promise<AppResult<boolean>> {
    try {
      const account = await this.server.loadAccount(accountId)
      const entry = account.balances.find(
        (b: any) =>
          'asset_code' in b &&
          b.asset_code === this.config.assetCode &&
          b.asset_issuer === this.config.issuerPublicKey,
      )
      if (!entry) return ok(false)
      return ok((entry as any).is_authorized === true)
    } catch {
      return err(new OnchainError('hasAuthorizedTrustline failed on Stellar', 0))
    }
  }

  // Allocates a tier-based PHPC subsidy to a beneficiary account.
// Tier 1 = 5000 PHPC, Tier 2 = 3500 PHPC.
// Payment comes from the distribution account.
  async allocateSubsidy(
    beneficiaryId: string,
    beneficiaryAccountId: string,
    tier: 1 | 2,
  ): Promise<AppResult<{ hash: string; ledger: number }>> {
    const amount = String(TIER_AMOUNTS[tier])
    try {
      const distKeypair = Keypair.fromSecret(this.config.distributionSecret)
      const sourceAccount = await this.server.loadAccount(distKeypair.publicKey())

      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination: beneficiaryAccountId,
            asset: this.asset,
            amount,
          }),
        )
        .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
        .build()

      tx.sign(distKeypair)

      const response = await this.server.submitTransaction(tx)
      return ok({ hash: response.hash, ledger: response.ledger })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      return err(
        new OnchainError(
          `allocateSubsidy failed on Stellar for beneficiary ${beneficiaryId}: ${msg}`,
          0,
        ),
      )
    }
  }

  // Settles a purchase: pays PHPC from beneficiary to merchant.
// The sponsor covers the transaction fee via a fee-bump transaction.
  async settlePurchase(input: {
    beneficiaryAccountId: string
    beneficiarySecret: string
    merchantAccountId: string
    amountStroops: bigint
  }): Promise<AppResult<{ hash: string; ledger: number }>> {
    const amountDecimal = stroopsToDecimal(input.amountStroops)
    try {
      const beneficiaryKeypair = Keypair.fromSecret(input.beneficiarySecret)
      const sourceAccount = await this.server.loadAccount(input.beneficiaryAccountId)

      const innerTx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination: input.merchantAccountId,
            asset: this.asset,
            amount: amountDecimal,
          }),
        )
        .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
        .build()

      innerTx.sign(beneficiaryKeypair)

      const sponsorKeypair = Keypair.fromSecret(this.config.sponsorSecret)
      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        sponsorKeypair,
        BASE_FEE,
        innerTx,
        this.config.networkPassphrase,
      )
      feeBumpTx.sign(sponsorKeypair)

      const response = await this.server.submitTransaction(feeBumpTx)
      return ok({ hash: response.hash, ledger: response.ledger })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      return err(new OnchainError(`settlePurchase failed on Stellar: ${msg}`, 0))
    }
  }

  // Settles multiple purchases in a single transaction.
// The sponsor acts as the transaction source (paying the fee and sequence number).
// Each beneficiary signs the transaction for their specific payment operation.
  async settlePurchasesBatch(
    purchases: {
      beneficiaryAccountId: string
      merchantAccountId: string
      amountStroops: bigint
      beneficiarySigner: (tx: any) => Promise<void>
    }[]
  ): Promise<AppResult<{ hash: string; ledger: number }>> {
    if (purchases.length === 0) return err(new OnchainError('Empty batch', 0))
    
    try {
      const sponsorKeypair = Keypair.fromSecret(this.config.sponsorSecret)
      const sponsorAccount = await this.server.loadAccount(sponsorKeypair.publicKey())

      const txBuilder = new TransactionBuilder(sponsorAccount, {
        fee: (Number(BASE_FEE) * purchases.length).toString(),
        networkPassphrase: this.config.networkPassphrase,
      })

      for (const p of purchases) {
        txBuilder.addOperation(
          Operation.payment({
            source: p.beneficiaryAccountId,
            destination: p.merchantAccountId,
            asset: this.asset,
            amount: stroopsToDecimal(p.amountStroops),
          })
        )
      }

      const tx = txBuilder.setTimeout(TRANSACTION_TIMEOUT_SECONDS).build()
      
      for (const p of purchases) {
        await p.beneficiarySigner(tx)
      }

      tx.sign(sponsorKeypair)

      const response = await this.server.submitTransaction(tx)
      return ok({ hash: response.hash, ledger: response.ledger })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      return err(new OnchainError(`settlePurchasesBatch failed: ${msg}`, 0))
    }
  }

  // Returns the latest ledger sequence number from Horizon.
// Used for forward-compatibility item F7.
  async getLedgerSequence(): Promise<AppResult<number>> {
    try {
      const page = await this.server.ledgers().order('desc').limit(1).call()
      const record = page.records[0]
      return ok(record.sequence)
    } catch {
      return err(new OnchainError('getLedgerSequence failed on Stellar', 0))
    }
  }

  // Provisions a Stellar account for a newly generated custodial keypair:
// sponsored account creation, PHPC trustline, and issuer authorization.
// Idempotent by construction (per Phase 3 / risk R2): each of the three
// steps checks current on-chain state before submitting, so calling this
// on an already-provisioned account submits nothing and returns ok. This
// mirrors the exact sequence `scripts/bootstrap-stellar.ts` and
// `scripts/provision-stellar-accounts.ts` already use for the treasury
// accounts and for re-provisioning after a testnet reset, but runs inline
// at registration/approval time so a beneficiary or merchant is usable
// on-chain immediately rather than only after a separate manual script run.
// `accountSecret` is the newly generated account's own secret seed — it
// is required to co-sign account creation (for
// `endSponsoringFutureReserves`) and to sign its own `changeTrust`
// operation. It is never persisted by this method; the caller is
// responsible for zeroizing/discarding it after this call returns.
  async provisionAccount(input: {
    accountId: string
    accountSecret: string
  }): Promise<AppResult<void>> {
    const accountKeypair = Keypair.fromSecret(input.accountSecret)
    const trustlineLimit = '50000' // Comfortably exceeds Tier 1 grant of 5,000

    try {
      // Step 1: create the account (sponsored by the LGU sponsor) if it does
      // not already exist on Horizon.
      let accountExists = true
      try {
        await this.server.loadAccount(input.accountId)
      } catch {
        accountExists = false
      }

      const sponsorKeypair = Keypair.fromSecret(this.config.sponsorSecret)

      if (!accountExists) {
        const sponsorAccount = await this.server.loadAccount(sponsorKeypair.publicKey())
        const createTx = new TransactionBuilder(sponsorAccount, {
          fee: BASE_FEE,
          networkPassphrase: this.config.networkPassphrase,
        })
          .addOperation(
            Operation.beginSponsoringFutureReserves({ sponsoredId: input.accountId }),
          )
          .addOperation(
            Operation.createAccount({ destination: input.accountId, startingBalance: '0' }),
          )
          .addOperation(Operation.endSponsoringFutureReserves({ source: input.accountId }))
          .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
          .build()

        createTx.sign(sponsorKeypair)
        createTx.sign(accountKeypair)
        await this.server.submitTransaction(createTx)
      }

      // Step 2: create the PHPC trustline (sponsored) if it does not already
      // exist, and step 3: authorize it if not already authorized. Both are
      // re-checked against current on-chain state for idempotency.
      const account = await this.server.loadAccount(input.accountId)
      const trustlineEntry = account.balances.find(
        (b: any) =>
          'asset_code' in b &&
          b.asset_code === this.config.assetCode &&
          b.asset_issuer === this.config.issuerPublicKey,
      ) as any

      if (!trustlineEntry) {
        const sponsorAccount2 = await this.server.loadAccount(sponsorKeypair.publicKey())
        const trustTx = new TransactionBuilder(sponsorAccount2, {
          fee: BASE_FEE,
          networkPassphrase: this.config.networkPassphrase,
        })
          .addOperation(
            Operation.beginSponsoringFutureReserves({ sponsoredId: input.accountId }),
          )
          .addOperation(
            Operation.changeTrust({
              asset: this.asset,
              limit: trustlineLimit,
              source: input.accountId,
            }),
          )
          .addOperation(Operation.endSponsoringFutureReserves({ source: input.accountId }))
          .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
          .build()

        trustTx.sign(sponsorKeypair)
        trustTx.sign(accountKeypair)
        await this.server.submitTransaction(trustTx)
      }

      const isAuthorized = trustlineEntry?.is_authorized === true
      if (!isAuthorized) {
        const issuerKeypair = Keypair.fromSecret(this.config.issuerSecret)
        const issuerAccount = await this.server.loadAccount(issuerKeypair.publicKey())
        const authTx = new TransactionBuilder(issuerAccount, {
          fee: BASE_FEE,
          networkPassphrase: this.config.networkPassphrase,
        })
          .addOperation(
            Operation.setTrustLineFlags({
              trustor: input.accountId,
              asset: this.asset,
              flags: { authorized: true },
            }),
          )
          .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
          .build()

        authTx.sign(issuerKeypair)
        await this.server.submitTransaction(authTx)
      }

      return ok(undefined)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      return err(new OnchainError(`provisionAccount failed on Stellar: ${msg}`, 0))
    }
  }

}
