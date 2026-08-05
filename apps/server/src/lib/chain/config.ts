// Stellar chain configuration loading and validation.
// Centralizes all Stellar configuration reading and validation. Every required
// variable is validated together and every offending variable is named in a
// single error. No partial config is ever returned.
// Cross-field validation: PHPC_ISSUER_PUBLIC_KEY is verified by deriving it
// from PHPC_ISSUER_SECRET and comparing. Mismatches report the public key var.
import { type AppResult, ValidationError, ok, err } from '../errors.js'
import { Keypair, Networks } from '@stellar/stellar-sdk'

export interface ChainConfig {
  // STELLAR_HORIZON_URL — non-empty http/https Horizon endpoint (testnet only).
  horizonUrl: string
  // STELLAR_NETWORK_PASSPHRASE — must equal Networks.TESTNET.
  networkPassphrase: string
  // PHPC_ASSET_CODE — non-empty Stellar asset code.
  assetCode: string
  // PHPC_ISSUER_PUBLIC_KEY — Stellar G-prefix public key.
  issuerPublicKey: string
  // PHPC_ISSUER_SECRET — Stellar S-prefix secret seed for the issuer.
  issuerSecret: string
  // PHPC_DISTRIBUTION_SECRET — Stellar S-prefix secret seed for distribution.
  distributionSecret: string
  // STELLAR_SPONSOR_SECRET — Stellar S-prefix secret seed for fee sponsoring.
  sponsorSecret: string
  // CUSTODIAL_KEY_ENCRYPTION_KEY — sourced separately from encrypted data.
  keyEncryptionKey: string
  // QR_TOKEN_SECRET — HS256 signing secret.
  qrTokenSecret: string
  // QR_TOKEN_TTL_SECONDS — positive integer seconds; defaults to 300.
  qrTokenTtlSeconds: number
}

// Loose env shape accepted by {@link loadChainConfig}.
export type ChainEnv = Partial<Record<string, string | undefined>>

// Validators

// True when `v` is a non-empty http/https URL that is NOT localhost,
// 127.0.0.1, or the mainnet Horizon host (horizon.stellar.org).
export function isHorizonUrl(v: string): boolean {
  if (!v) return false
  let parsed: URL
  try {
    parsed = new URL(v)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1') return false
  if (host === 'horizon.stellar.org') return false
  return true
}

// True when `v` is a valid Stellar public key (G + 55 base32 chars).
export function isStellarPublicKey(v: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(v)
}

// True when `v` is a valid Stellar secret seed (S + 55 base32 chars).
export function isStellarSecretSeed(v: string): boolean {
  return /^S[A-Z2-7]{55}$/.test(v)
}

// loadChainConfig

const DEFAULT_QR_TOKEN_TTL_SECONDS = 300

// Loads and validates every Stellar configuration variable from `env`.
// Collects and reports EVERY offending variable in a single error. Missing,
// empty, or malformed variables never short-circuit the check for the rest.
// No partial `ChainConfig` is ever returned; either all variables are valid
// and a complete config is returned, or none of the fields are applied.
export function loadChainConfig(env: ChainEnv): AppResult<ChainConfig> {
  const errors: string[] = []

  const horizonUrl = env.STELLAR_HORIZON_URL
  const networkPassphrase = env.STELLAR_NETWORK_PASSPHRASE
  const assetCode = env.PHPC_ASSET_CODE
  const issuerPublicKey = env.PHPC_ISSUER_PUBLIC_KEY
  const issuerSecret = env.PHPC_ISSUER_SECRET
  const distributionSecret = env.PHPC_DISTRIBUTION_SECRET
  const sponsorSecret = env.STELLAR_SPONSOR_SECRET
  const keyEncryptionKey = env.CUSTODIAL_KEY_ENCRYPTION_KEY
  const qrTokenSecret = env.QR_TOKEN_SECRET
  const qrTokenTtlRaw = env.QR_TOKEN_TTL_SECONDS

  // Horizon URL
  if (!horizonUrl || !isHorizonUrl(horizonUrl)) {
    errors.push('STELLAR_HORIZON_URL')
  }

  // Network passphrase must exactly equal testnet
  if (!networkPassphrase || networkPassphrase !== Networks.TESTNET) {
    errors.push('STELLAR_NETWORK_PASSPHRASE')
  }

  // Asset code must be non-empty
  if (!assetCode) {
    errors.push('PHPC_ASSET_CODE')
  }

  // Issuer public key format
  let issuerPublicKeyValid = false
  if (!issuerPublicKey || !isStellarPublicKey(issuerPublicKey)) {
    errors.push('PHPC_ISSUER_PUBLIC_KEY')
  } else {
    issuerPublicKeyValid = true
  }

  // Issuer secret seed format
  let issuerSecretValid = false
  if (!issuerSecret || !isStellarSecretSeed(issuerSecret)) {
    errors.push('PHPC_ISSUER_SECRET')
  } else {
    issuerSecretValid = true
  }

  // Cross-field derivation: only attempt when both formats are individually valid
  if (issuerSecretValid && issuerPublicKeyValid) {
    try {
      const derived = Keypair.fromSecret(issuerSecret!).publicKey()
      if (derived !== issuerPublicKey) {
        errors.push('PHPC_ISSUER_PUBLIC_KEY')
      }
    } catch {
      // Should not happen since isStellarSecretSeed passed, but guard anyway
      errors.push('PHPC_ISSUER_SECRET')
    }
  }

  // Distribution secret
  if (!distributionSecret || !isStellarSecretSeed(distributionSecret)) {
    errors.push('PHPC_DISTRIBUTION_SECRET')
  }

  // Sponsor secret
  if (!sponsorSecret || !isStellarSecretSeed(sponsorSecret)) {
    errors.push('STELLAR_SPONSOR_SECRET')
  }

  // Key encryption key
  if (!keyEncryptionKey) {
    errors.push('CUSTODIAL_KEY_ENCRYPTION_KEY')
  }

  // QR token secret
  if (!qrTokenSecret) {
    errors.push('QR_TOKEN_SECRET')
  }

  // QR_TOKEN_TTL_SECONDS is optional; when present it must be a positive
  // integer, otherwise it is treated as an offending variable.
  let qrTokenTtlSeconds = DEFAULT_QR_TOKEN_TTL_SECONDS
  if (qrTokenTtlRaw !== undefined && qrTokenTtlRaw !== '') {
    const parsed = Number(qrTokenTtlRaw)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.push('QR_TOKEN_TTL_SECONDS')
    } else {
      qrTokenTtlSeconds = parsed
    }
  }

  if (errors.length > 0) {
    return err(
      new ValidationError('Invalid Stellar configuration', {
        invalidVariables: errors,
      }),
    )
  }

  return ok({
    horizonUrl: horizonUrl as string,
    networkPassphrase: networkPassphrase as string,
    assetCode: assetCode as string,
    issuerPublicKey: issuerPublicKey as string,
    issuerSecret: issuerSecret as string,
    distributionSecret: distributionSecret as string,
    sponsorSecret: sponsorSecret as string,
    keyEncryptionKey: keyEncryptionKey as string,
    qrTokenSecret: qrTokenSecret as string,
    qrTokenTtlSeconds,
  })
}
