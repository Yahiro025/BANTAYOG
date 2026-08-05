// CustodialWalletService — Stellar keypair generation, encrypted custody,
// and signing for beneficiary and merchant wallets.
// Per the Stellar migration design: this service generates a Stellar
// ed25519 keypair, verifies the derived address is globally unique (retrying
// up to 3 attempts on collision), encrypts the raw secret seed at rest with
// AES-256-GCM, and persists only the ciphertext/iv/authTag — the plaintext
// seed is never stored. Decryption recovers the seed into a `Buffer` held
// only for the duration of the callback and zeroizes it in a `finally` block
// regardless of outcome.
// The constructor accepts only `ChainConfig`; individual methods accept the
// appropriate repository so a single service instance works for both
// beneficiary and merchant roles.
// Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import { Keypair } from '@stellar/stellar-sdk'
import type { ChainConfig } from '../lib/chain/config.js'
import type { BeneficiaryWalletRepository } from '../repositories/beneficiary-wallet.repository.js'
import type { MerchantWalletRepository } from '../repositories/merchant-wallet.repository.js'
import type { StellarClient } from './chain.client.js'
import { type AppResult, ValidationError, PersistenceError, ok, err } from '../lib/errors.js'

// AES-256-GCM cipher algorithm identifier.
const ALGORITHM = 'aes-256-gcm'

// GCM IV length in bytes (96-bit, the recommended size for GCM).
const IV_LENGTH_BYTES = 12

// Maximum keypair-generation attempts before treating generation as failed.
const MAX_GENERATION_ATTEMPTS = 3

// The AES-256-GCM ciphertext/iv/authTag triple persisted for an encrypted
// secret seed. The encryption key itself is never stored here — it is
// sourced separately from `ChainConfig.keyEncryptionKey`.
export interface EncryptedKey {
  // base64-encoded ciphertext.
  ciphertext: string
  // base64-encoded IV, unique per record.
  iv: string
  // base64-encoded AES-GCM authentication tag.
  authTag: string
}

// Union of wallet repository types accepted by this service.
type WalletRepository = BeneficiaryWalletRepository | MerchantWalletRepository

export class CustodialWalletService {
  constructor(private readonly config: ChainConfig) {}

  // Derives a 32-byte AES-256 key from `config.keyEncryptionKey`.
// `keyEncryptionKey` is an arbitrary-length UTF-8 string sourced from the
// environment (Requirement 6.1: "an encryption key that is stored
// separately from the encrypted data"). AES-256-GCM requires exactly a
// 32-byte key, so the configured string is hashed with SHA-256 to obtain a
// fixed-length 32-byte key deterministically, regardless of the input
// string's length.
  private deriveEncryptionKey(): Buffer {
    return createHash('sha256').update(this.config.keyEncryptionKey).digest()
  }

  // Encrypts `seedBytes` with AES-256-GCM using a fresh random IV.
  private encryptPrivateKey(seedBytes: Buffer): EncryptedKey {
    const key = this.deriveEncryptionKey()
    const iv = randomBytes(IV_LENGTH_BYTES)
    const cipher = createCipheriv(ALGORITHM, key, iv)
    const ciphertext = Buffer.concat([cipher.update(seedBytes), cipher.final()])
    const authTag = cipher.getAuthTag()
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    }
  }

  // Decrypts a stored {@link EncryptedKey} back into the raw secret-seed
// bytes using AES-256-GCM. Throws on auth-tag mismatch or corrupted
// ciphertext — callers must catch and must not leak the thrown error's
// message (which may reference cipher internals) to API responses.
  private decryptPrivateKey(encrypted: EncryptedKey): Buffer {
    const key = this.deriveEncryptionKey()
    const iv = Buffer.from(encrypted.iv, 'base64')
    const authTag = Buffer.from(encrypted.authTag, 'base64')
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64')
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  }

  // Generates a new Stellar keypair for the given entity, retries up to 3
// total attempts if the derived address collides with an existing wallet
// address in the provided repository, encrypts the 32-byte ed25519 raw
// secret seed with AES-256-GCM, and persists only the ciphertext/iv/authTag
// alongside the public key (G... address). Never persists a plaintext or
// partially-encrypted seed.
// When `chainClient` is provided, this method also provisions the account
// on-chain immediately: sponsored account creation, PHPC trustline, and
// issuer authorization (`StellarClient.provisionAccount`), using the
// keypair's secret while it is still held in memory. This closes the gap
// where a generated wallet exists only in Postgres and has no matching
// Stellar account until someone runs the standalone provisioning script.
// On-chain provisioning failure does NOT fail this method as a whole —
// the encrypted DB row is the source of truth and is already persisted by
// the time provisioning runs. The returned `provisioned` flag reports
// whether the on-chain steps actually succeeded, so callers can react
// (e.g. keep a merchant in PENDING rather than APPROVED) without losing
// the generated wallet entirely to a transient Horizon outage.
// `scripts/provision-stellar-accounts.ts` can re-provision it later
// (idempotently) once Horizon is reachable again.
// Requirements: 5.1, 5.2, 5.3, 5.4, 6.1
  async generateWallet(
    entityId: string,
    role: 'beneficiary' | 'merchant',
    repo: WalletRepository,
    chainClient?: StellarClient,
  ): Promise<AppResult<{ address: string; provisioned: boolean }>> {
    const tableName = role === 'beneficiary' ? 'beneficiary_wallets' : 'merchant_wallets'

    let address: string | undefined
    let seedBuffer: Buffer | undefined
    let generatedKeypair: Keypair | undefined

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      const keypair = Keypair.random()
      const candidateAddress = keypair.publicKey()

      let existing: unknown[]
      try {
        existing = await repo.findBy('address', candidateAddress, 1)
      } catch {
        return err(
          new PersistenceError(
            `Failed to check ${role} wallet address uniqueness`,
            tableName,
          ),
        )
      }

      if (existing.length === 0) {
        address = candidateAddress
        seedBuffer = Buffer.from(keypair.rawSecretKey())
        generatedKeypair = keypair
        break
      }
    }

    if (!address || !seedBuffer || !generatedKeypair) {
      return err(
        new ValidationError(
          `Failed to generate a unique ${role} wallet address after ${MAX_GENERATION_ATTEMPTS} attempts`,
        ),
      )
    }

    const encrypted = this.encryptPrivateKey(seedBuffer)

    try {
      const row = {
        address,
        enc_ciphertext: encrypted.ciphertext,
        enc_iv: encrypted.iv,
        enc_auth_tag: encrypted.authTag,
      }
      if (role === 'beneficiary') {
        await (repo as BeneficiaryWalletRepository).insert({
          beneficiary_id: entityId,
          ...row,
        })
      } else {
        await (repo as MerchantWalletRepository).insert({
          merchant_id: entityId,
          ...row,
        })
      }
    } catch {
      seedBuffer.fill(0)
      return err(
        new PersistenceError(`Failed to persist ${role} wallet`, tableName),
      )
    }

    // Provision the account on-chain while the secret is still in memory.
    // Zeroize the buffer only after this step, regardless of outcome.
    //
    // Provisioning failure does NOT fail wallet generation as a whole: the
    // encrypted DB row (the source of truth) is already persisted, and
    // `scripts/provision-stellar-accounts.ts` can re-provision it later
    // idempotently once Horizon is reachable. Blocking the entire
    // registration/approval flow on a transient Horizon outage would be a
    // worse failure mode than a beneficiary/merchant temporarily existing
    // without a live on-chain account — callers that need to know can still
    // inspect `provisioned` on the returned value.
    let provisioned = true
    if (chainClient) {
      const provisionResult = await chainClient.provisionAccount({
        accountId: address,
        accountSecret: generatedKeypair.secret(),
      })
      seedBuffer.fill(0)
      if (provisionResult.isErr()) {
        provisioned = false
      }
    } else {
      seedBuffer.fill(0)
      provisioned = false
    }

    return ok({ address, provisioned })
  }

  // Decrypts the stored secret seed for the given entity into a `Buffer`,
// reconstructs a Stellar `Keypair` from it, invokes `callback`, and
// zeroizes the decrypted buffer in a `finally` block regardless of whether
// `callback` succeeds or throws. On decryption failure, the operation
// aborts immediately without invoking `callback`, the stored ciphertext is
// left unchanged, and the returned error excludes all key material.
// Requirements: 5.1 (signing over the generated wallet), 6.2, 6.3, 6.4
  async withDecryptedKey<T>(
    entityId: string,
    role: 'beneficiary' | 'merchant',
    repo: WalletRepository,
    callback: (keypair: Keypair) => Promise<T>,
  ): Promise<AppResult<T>> {
    const tableName = role === 'beneficiary' ? 'beneficiary_wallets' : 'merchant_wallets'
    const idColumn = role === 'beneficiary' ? 'beneficiary_id' : 'merchant_id'

    let rows: { enc_ciphertext: string; enc_iv: string; enc_auth_tag: string }[]
    try {
      rows = await repo.findBy(idColumn, entityId, 1)
    } catch {
      return err(
        new PersistenceError(`Failed to look up ${role} wallet`, tableName),
      )
    }

    const row = rows[0]
    if (!row) {
      return err(new ValidationError(`No wallet found for ${role}`))
    }

    let seedBuffer: Buffer | undefined
    try {
      seedBuffer = this.decryptPrivateKey({
        ciphertext: row.enc_ciphertext,
        iv: row.enc_iv,
        authTag: row.enc_auth_tag,
      })
    } catch {
      // Decryption failed (e.g. auth tag mismatch or corrupted ciphertext).
      // Abort without invoking the callback; the stored row is never touched,
      // and no key material is included in the error.
      return err(new ValidationError(`Failed to decrypt ${role} wallet key`))
    }

    try {
      const keypair = Keypair.fromRawEd25519Seed(seedBuffer)
      const result = await callback(keypair)
      return ok(result)
    } catch {
      return err(new ValidationError('Signing operation failed'))
    } finally {
      // Zeroize the decrypted seed buffer whether the callback succeeded or threw.
      seedBuffer.fill(0)
    }
  }
}
