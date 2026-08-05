/**
 * scripts/provision-stellar-accounts.ts
 *
 * Re-provisions Stellar accounts for existing beneficiary_wallets and
 * merchant_wallets rows. Intended for use after a Stellar testnet reset
 * (risk R2) when stored keypairs still decrypt but the on-chain accounts
 * no longer exist.
 *
 * For each row:
 *   1. Decrypts the stored seed to recover the Keypair.
 *   2. Checks if the account already exists on Horizon.
 *   3. Creates the account (sponsored) if missing.
 *   4. Creates the PHPC trustline if missing.
 *   5. Authorizes the trustline if not already authorized.
 *
 * Usage:
 *   pnpm provision:stellar
 *   pnpm provision:stellar -- --dry-run
 */
import { createHash, createDecipheriv } from 'node:crypto'
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org'
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET
const ASSET_CODE = process.env.PHPC_ASSET_CODE || 'PHPC'
const ISSUER_SECRET = process.env.PHPC_ISSUER_SECRET
const SPONSOR_SECRET = process.env.STELLAR_SPONSOR_SECRET
const KEY_ENCRYPTION_KEY = process.env.CUSTODIAL_KEY_ENCRYPTION_KEY
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const TRUSTLINE_LIMIT = '50000' // Comfortably exceeds Tier 1 grant of 5,000
const TRANSACTION_TIMEOUT_SECONDS = 180
const DRY_RUN = process.argv.includes('--dry-run')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

function decryptSeed(row: { enc_ciphertext: string; enc_iv: string; enc_auth_tag: string }): Buffer {
  const key = deriveKey(KEY_ENCRYPTION_KEY!)
  const iv = Buffer.from(row.enc_iv, 'base64')
  const authTag = Buffer.from(row.enc_auth_tag, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const ciphertext = Buffer.from(row.enc_ciphertext, 'base64')
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

async function accountExists(server: Horizon.Server, publicKey: string): Promise<boolean> {
  try {
    await server.loadAccount(publicKey)
    return true
  } catch (e: any) {
    if (e?.response?.status === 404) return false
    throw e
  }
}

async function hasTrustline(server: Horizon.Server, publicKey: string, asset: Asset): Promise<boolean> {
  try {
    const account = await server.loadAccount(publicKey)
    return account.balances.some(
      (b: any) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
    )
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Validate required env
  const missing: string[] = []
  if (!ISSUER_SECRET) missing.push('PHPC_ISSUER_SECRET')
  if (!SPONSOR_SECRET) missing.push('STELLAR_SPONSOR_SECRET')
  if (!KEY_ENCRYPTION_KEY) missing.push('CUSTODIAL_KEY_ENCRYPTION_KEY')
  if (!SUPABASE_URL) missing.push('SUPABASE_URL')
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }

  const issuerKeypair = Keypair.fromSecret(ISSUER_SECRET!)
  const sponsorKeypair = Keypair.fromSecret(SPONSOR_SECRET!)
  const phpcAsset = new Asset(ASSET_CODE, issuerKeypair.publicKey())
  const server = new Horizon.Server(HORIZON_URL)

  // Dynamic import for Supabase to avoid bundling issues
  const { createClient } = await import('@supabase/supabase-js')
  const db = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

  console.log(`Provisioning Stellar accounts (dry-run: ${DRY_RUN})`)
  console.log(`Horizon: ${HORIZON_URL}`)
  console.log(`Asset: ${ASSET_CODE}:${issuerKeypair.publicKey().slice(0, 8)}...`)
  console.log('')

  let provisioned = 0
  let skipped = 0
  let failed = 0

  // Process beneficiary wallets
  const { data: beneficiaryRows } = await db
    .from('beneficiary_wallets')
    .select('beneficiary_id, address, enc_ciphertext, enc_iv, enc_auth_tag')

  console.log(`Found ${beneficiaryRows?.length ?? 0} beneficiary wallet rows`)

  for (const row of beneficiaryRows ?? []) {
    try {
      await provisionAccount(server, row, phpcAsset, issuerKeypair, sponsorKeypair, 'beneficiary')
      provisioned++
    } catch (e: any) {
      console.error(`  FAILED beneficiary ${row.address.slice(0, 8)}...: ${e.message}`)
      failed++
    }
  }

  // Process merchant wallets
  const { data: merchantRows } = await db
    .from('merchant_wallets')
    .select('merchant_id, address, enc_ciphertext, enc_iv, enc_auth_tag')

  console.log(`Found ${merchantRows?.length ?? 0} merchant wallet rows`)

  for (const row of merchantRows ?? []) {
    try {
      await provisionAccount(server, row, phpcAsset, issuerKeypair, sponsorKeypair, 'merchant')
      provisioned++
    } catch (e: any) {
      console.error(`  FAILED merchant ${row.address.slice(0, 8)}...: ${e.message}`)
      failed++
    }
  }

  console.log('')
  console.log(`Done. Provisioned: ${provisioned}, Skipped: ${skipped}, Failed: ${failed}`)

  async function provisionAccount(
    server: Horizon.Server,
    row: { address: string; enc_ciphertext: string; enc_iv: string; enc_auth_tag: string },
    asset: Asset,
    issuer: Keypair,
    sponsor: Keypair,
    role: string,
  ) {
    const publicKey = row.address

    // Step 1: Check if account exists
    const exists = await accountExists(server, publicKey)

    if (!exists) {
      console.log(`  ${role} ${publicKey.slice(0, 8)}...: creating account`)
      if (!DRY_RUN) {
        const sponsorAccount = await server.loadAccount(sponsor.publicKey())
        const tx = new TransactionBuilder(sponsorAccount, {
          fee: BASE_FEE,
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(
            Operation.beginSponsoringFutureReserves({ sponsoredId: publicKey }),
          )
          .addOperation(
            Operation.createAccount({ destination: publicKey, startingBalance: '0' }),
          )
          .addOperation(
            Operation.endSponsoringFutureReserves({ source: publicKey }),
          )
          .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
          .build()

        // Sign with sponsor and the new account (for endSponsoringFutureReserves)
        tx.sign(sponsor)
        const seedBuffer = decryptSeed(row)
        const accountKeypair = Keypair.fromRawEd25519Seed(seedBuffer)
        seedBuffer.fill(0)
        tx.sign(accountKeypair)
        await server.submitTransaction(tx)
      }
    } else {
      skipped++
    }

    // Step 2: Check trustline
    if (!DRY_RUN && !(await hasTrustline(server, publicKey, asset))) {
      console.log(`  ${role} ${publicKey.slice(0, 8)}...: creating trustline`)
      const seedBuffer = decryptSeed(row)
      const accountKeypair = Keypair.fromRawEd25519Seed(seedBuffer)
      seedBuffer.fill(0)

      const sponsorAccount = await server.loadAccount(sponsor.publicKey())
      const tx = new TransactionBuilder(sponsorAccount, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.beginSponsoringFutureReserves({ sponsoredId: publicKey }),
        )
        .addOperation(
          Operation.changeTrust({
            asset,
            limit: TRUSTLINE_LIMIT,
            source: publicKey,
          }),
        )
        .addOperation(
          Operation.endSponsoringFutureReserves({ source: publicKey }),
        )
        .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
        .build()

      tx.sign(sponsor)
      tx.sign(accountKeypair)
      await server.submitTransaction(tx)

      // Step 3: Authorize the trustline
      console.log(`  ${role} ${publicKey.slice(0, 8)}...: authorizing trustline`)
      const issuerAccount = await server.loadAccount(issuer.publicKey())
      const authTx = new TransactionBuilder(issuerAccount, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.setTrustLineFlags({
            trustor: publicKey,
            asset,
            flags: { authorized: true },
          }),
        )
        .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
        .build()

      authTx.sign(issuer)
      await server.submitTransaction(authTx)
    }
  }
}

main().catch((e) => {
  console.error('Fatal error:', e.message)
  process.exit(1)
})
