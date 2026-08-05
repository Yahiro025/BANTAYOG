// Property-based and unit tests for `loadChainConfig`.
// Feature: stellar-migration
// Property 1: Chain config loads valid env and reports every offender otherwise
// Property 2: Runtime config never targets mainnet or local Horizon
// Validates Stellar configuration loading with cross-field key derivation.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { Keypair, Networks } from '@stellar/stellar-sdk'
import {
  loadChainConfig,
  isHorizonUrl,
  isStellarPublicKey,
  isStellarSecretSeed,
  type ChainEnv,
} from './config.js'
import { ValidationError } from '../errors.js'

// Helpers: Generate a valid Stellar keypair for tests

function generateValidKeypair(): { publicKey: string; secretSeed: string } {
  const kp = Keypair.random()
  return { publicKey: kp.publicKey(), secretSeed: kp.secret() }
}

// A fixed valid keypair for deterministic tests
const FIXED_KEYPAIR = generateValidKeypair()

// Arbitraries - valid values for each required field

const validHorizonUrlArb = fc.constantFrom(
  'https://horizon-testnet.stellar.org',
  'https://horizon.example.com',
  'http://stellar-rpc.example.net',
)

const validNetworkPassphraseArb = fc.constant(Networks.TESTNET)

const validAssetCodeArb = fc.constantFrom('PHPC', 'XLM', 'USD')

// Generate valid Stellar public keys using the SDK

// Generate valid Stellar secret seeds using the SDK

// keyEncryptionKey/qrTokenSecret only require non-empty
const validSecretArb = fc.string({ minLength: 1, maxLength: 40 })

const validTtlArb = fc.integer({ min: 1, max: 100_000 }).map((n) => String(n))

// For cross-field validation we need matched keypairs
const validEnvArbitrary: fc.Arbitrary<ChainEnv> = fc
  .constant(null)
  .chain(() => {
    const issuerKp = Keypair.random()
    const distributionKp = Keypair.random()
    const sponsorKp = Keypair.random()
    return fc.record({
      STELLAR_HORIZON_URL: validHorizonUrlArb,
      STELLAR_NETWORK_PASSPHRASE: validNetworkPassphraseArb,
      PHPC_ASSET_CODE: validAssetCodeArb,
      PHPC_ISSUER_PUBLIC_KEY: fc.constant(issuerKp.publicKey()),
      PHPC_ISSUER_SECRET: fc.constant(issuerKp.secret()),
      PHPC_DISTRIBUTION_SECRET: fc.constant(distributionKp.secret()),
      STELLAR_SPONSOR_SECRET: fc.constant(sponsorKp.secret()),
      CUSTODIAL_KEY_ENCRYPTION_KEY: validSecretArb,
      QR_TOKEN_SECRET: validSecretArb,
      QR_TOKEN_TTL_SECONDS: fc.option(validTtlArb, { nil: undefined }),
    })
  })

// Arbitraries - bad-value pools for each required field

const badHorizonUrlArb = fc.constantFrom(
  undefined,
  '',
  'not-a-url',
  'ftp://bad.com',
  'http://localhost:3000',
  'http://127.0.0.1:8545',
  'https://horizon.stellar.org', // mainnet - rejected
)

const badNetworkPassphraseArb = fc.constantFrom(
  undefined,
  '',
  'Public Global Stellar Network ; September 2015', // mainnet passphrase
  'wrong passphrase',
)

const badAssetCodeArb = fc.constantFrom(undefined, '')

const badPublicKeyArb = fc.constantFrom(
  undefined,
  '',
  'GINVALID', // too short
  'X' + 'A'.repeat(55), // wrong prefix
  'G' + '1'.repeat(55), // invalid base32 chars (1 is not in A-Z2-7)
)

const badSecretSeedArb = fc.constantFrom(
  undefined,
  '',
  'SINVALID', // too short
  'X' + 'A'.repeat(55), // wrong prefix
  'S' + '1'.repeat(55), // invalid base32 chars
)

const badSecretArb = fc.constantFrom(undefined, '')

interface RequiredField {
  name: string
  badValues: fc.Arbitrary<string | undefined>
}

const requiredFields: RequiredField[] = [
  { name: 'STELLAR_HORIZON_URL', badValues: badHorizonUrlArb },
  { name: 'STELLAR_NETWORK_PASSPHRASE', badValues: badNetworkPassphraseArb },
  { name: 'PHPC_ASSET_CODE', badValues: badAssetCodeArb },
  { name: 'PHPC_ISSUER_PUBLIC_KEY', badValues: badPublicKeyArb },
  { name: 'PHPC_ISSUER_SECRET', badValues: badSecretSeedArb },
  { name: 'PHPC_DISTRIBUTION_SECRET', badValues: badSecretSeedArb },
  { name: 'STELLAR_SPONSOR_SECRET', badValues: badSecretSeedArb },
  { name: 'CUSTODIAL_KEY_ENCRYPTION_KEY', badValues: badSecretArb },
  { name: 'QR_TOKEN_SECRET', badValues: badSecretArb },
]

// Picks one required field index, then a bad value from that field's pool.
const invalidFieldSelectionArb = fc
  .integer({ min: 0, max: requiredFields.length - 1 })
  .chain((idx) => requiredFields[idx].badValues.map((badValue) => ({ idx, badValue })))

// A valid baseline env with exactly one required field overridden with an
// invalid value, guaranteeing exactly one known offender while the rest of
// the fields stay valid.
const envWithOneInvalidFieldArbitrary = fc
  .tuple(validEnvArbitrary, invalidFieldSelectionArb)
  .map(([validEnv, { idx, badValue }]) => {
    const fieldName = requiredFields[idx].name
    return {
      env: { ...validEnv, [fieldName]: badValue } as ChainEnv,
      offendingField: fieldName,
    }
  })

// Extracts `invalidVariables` from an error's details, asserting the shape.
function getInvalidVariables(error: ValidationError): string[] {
  const details = error.details as { invalidVariables?: unknown }
  expect(Array.isArray(details?.invalidVariables)).toBe(true)
  return details.invalidVariables as string[]
}

// Helper: build a valid env for unit tests

function buildValidEnv(overrides: ChainEnv = {}): ChainEnv {
  return {
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
    PHPC_ASSET_CODE: 'PHPC',
    PHPC_ISSUER_PUBLIC_KEY: FIXED_KEYPAIR.publicKey,
    PHPC_ISSUER_SECRET: FIXED_KEYPAIR.secretSeed,
    PHPC_DISTRIBUTION_SECRET: Keypair.random().secret(),
    STELLAR_SPONSOR_SECRET: Keypair.random().secret(),
    CUSTODIAL_KEY_ENCRYPTION_KEY: 'test-key-encryption-key',
    QR_TOKEN_SECRET: 'test-qr-token-secret',
    ...overrides,
  }
}

// Validator unit tests: isHorizonUrl

describe('isHorizonUrl', () => {
  it('accepts valid testnet Horizon URL', () => {
    expect(isHorizonUrl('https://horizon-testnet.stellar.org')).toBe(true)
  })

  it('accepts other valid http/https URLs', () => {
    expect(isHorizonUrl('https://example.com/horizon')).toBe(true)
    expect(isHorizonUrl('http://my-horizon.example.net')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isHorizonUrl('')).toBe(false)
  })

  it('rejects non-URL strings', () => {
    expect(isHorizonUrl('not-a-url')).toBe(false)
  })

  it('rejects ftp protocol', () => {
    expect(isHorizonUrl('ftp://example.com')).toBe(false)
  })

  it('rejects localhost', () => {
    expect(isHorizonUrl('http://localhost:8000')).toBe(false)
  })

  it('rejects 127.0.0.1', () => {
    expect(isHorizonUrl('http://127.0.0.1:8000')).toBe(false)
  })

  it('rejects mainnet horizon.stellar.org (case-insensitive)', () => {
    expect(isHorizonUrl('https://horizon.stellar.org')).toBe(false)
    expect(isHorizonUrl('https://Horizon.Stellar.Org')).toBe(false)
    expect(isHorizonUrl('https://HORIZON.STELLAR.ORG')).toBe(false)
  })
})

// Validator unit tests: isStellarPublicKey

describe('isStellarPublicKey', () => {
  it('accepts a valid SDK-generated public key', () => {
    const kp = Keypair.random()
    expect(isStellarPublicKey(kp.publicKey())).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isStellarPublicKey('')).toBe(false)
  })

  it('rejects key too short', () => {
    expect(isStellarPublicKey('GABCDE')).toBe(false)
  })

  it('rejects key with wrong prefix', () => {
    expect(isStellarPublicKey('S' + 'A'.repeat(55))).toBe(false)
  })

  it('rejects key with invalid base32 characters', () => {
    expect(isStellarPublicKey('G' + '1'.repeat(55))).toBe(false)
  })
})

// Validator unit tests: isStellarSecretSeed

describe('isStellarSecretSeed', () => {
  it('accepts a valid SDK-generated secret seed', () => {
    const kp = Keypair.random()
    expect(isStellarSecretSeed(kp.secret())).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isStellarSecretSeed('')).toBe(false)
  })

  it('rejects seed too short', () => {
    expect(isStellarSecretSeed('SABCDE')).toBe(false)
  })

  it('rejects seed with wrong prefix', () => {
    expect(isStellarSecretSeed('G' + 'A'.repeat(55))).toBe(false)
  })

  it('rejects seed with invalid base32 characters', () => {
    expect(isStellarSecretSeed('S' + '1'.repeat(55))).toBe(false)
  })
})

// Property 1: Chain config loads valid env and reports every offender otherwise

describe('Property 1: loadChainConfig loads valid env and reports every offender otherwise', () => {
  it('returns ok(...) with fields matching the input for every all-valid env', () => {
    fc.assert(
      fc.property(validEnvArbitrary, (env) => {
        const result = loadChainConfig(env)
        expect(result.isOk()).toBe(true)
        if (result.isOk()) {
          const config = result.value
          expect(config.horizonUrl).toBe(env.STELLAR_HORIZON_URL)
          expect(config.networkPassphrase).toBe(env.STELLAR_NETWORK_PASSPHRASE)
          expect(config.assetCode).toBe(env.PHPC_ASSET_CODE)
          expect(config.issuerPublicKey).toBe(env.PHPC_ISSUER_PUBLIC_KEY)
          expect(config.issuerSecret).toBe(env.PHPC_ISSUER_SECRET)
          expect(config.distributionSecret).toBe(env.PHPC_DISTRIBUTION_SECRET)
          expect(config.sponsorSecret).toBe(env.STELLAR_SPONSOR_SECRET)
          expect(config.keyEncryptionKey).toBe(env.CUSTODIAL_KEY_ENCRYPTION_KEY)
          expect(config.qrTokenSecret).toBe(env.QR_TOKEN_SECRET)
          expect(config.qrTokenTtlSeconds).toBe(
            env.QR_TOKEN_TTL_SECONDS ? Number(env.QR_TOKEN_TTL_SECONDS) : 300,
          )
        }
      }),
      { numRuns: 100 },
    )
  })

  it('returns err(...) naming at least the overridden offender for envs with at least one invalid field', () => {
    fc.assert(
      fc.property(envWithOneInvalidFieldArbitrary, ({ env, offendingField }) => {
        const result = loadChainConfig(env)
        expect(result.isErr()).toBe(true)
        if (result.isErr()) {
          expect(result.error).toBeInstanceOf(ValidationError)
          const invalidVariables = getInvalidVariables(result.error as ValidationError)
          expect(invalidVariables.length).toBeGreaterThan(0)
          // Note: PHPC_ISSUER_PUBLIC_KEY may also appear due to cross-field
          // derivation mismatch when PHPC_ISSUER_SECRET is invalid, so we
          // check the direct offender is included.
          expect(invalidVariables).toContain(offendingField)
        }
      }),
      { numRuns: 100 },
    )
  })
})

// Property 2: Runtime config never targets mainnet or local Horizon

describe('Property 2: runtime config never targets mainnet or local Horizon', () => {
  it('never returns a horizon.stellar.org or localhost URL for valid envs', () => {
    fc.assert(
      fc.property(validEnvArbitrary, (env) => {
        const result = loadChainConfig(env)
        if (result.isOk()) {
          expect(result.value.horizonUrl).not.toMatch(/horizon\.stellar\.org/i)
          expect(result.value.horizonUrl).not.toMatch(/localhost|127\.0\.0\.1/)
        }
      }),
      { numRuns: 100 },
    )
  })
})

// Unit tests: specific error messages

describe('loadChainConfig unit tests: specific error messages', () => {
  it('names STELLAR_HORIZON_URL when the URL is missing', () => {
    const result = loadChainConfig(buildValidEnv({ STELLAR_HORIZON_URL: undefined }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('STELLAR_HORIZON_URL')
    }
  })

  it('names STELLAR_HORIZON_URL when given a mainnet URL', () => {
    const result = loadChainConfig(
      buildValidEnv({ STELLAR_HORIZON_URL: 'https://horizon.stellar.org' }),
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('STELLAR_HORIZON_URL')
    }
  })

  it('names STELLAR_NETWORK_PASSPHRASE when not matching testnet', () => {
    const result = loadChainConfig(
      buildValidEnv({ STELLAR_NETWORK_PASSPHRASE: 'wrong passphrase' }),
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('STELLAR_NETWORK_PASSPHRASE')
    }
  })

  it('names PHPC_ASSET_CODE when missing', () => {
    const result = loadChainConfig(buildValidEnv({ PHPC_ASSET_CODE: '' }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('PHPC_ASSET_CODE')
    }
  })

  it('names PHPC_ISSUER_PUBLIC_KEY when malformed', () => {
    const result = loadChainConfig(buildValidEnv({ PHPC_ISSUER_PUBLIC_KEY: 'invalid' }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('PHPC_ISSUER_PUBLIC_KEY')
    }
  })

  it('names PHPC_ISSUER_SECRET when malformed', () => {
    const result = loadChainConfig(buildValidEnv({ PHPC_ISSUER_SECRET: 'invalid' }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('PHPC_ISSUER_SECRET')
    }
  })

  it('names PHPC_DISTRIBUTION_SECRET when malformed', () => {
    const result = loadChainConfig(buildValidEnv({ PHPC_DISTRIBUTION_SECRET: 'invalid' }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('PHPC_DISTRIBUTION_SECRET')
    }
  })

  it('names STELLAR_SPONSOR_SECRET when malformed', () => {
    const result = loadChainConfig(buildValidEnv({ STELLAR_SPONSOR_SECRET: 'invalid' }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('STELLAR_SPONSOR_SECRET')
    }
  })

  it('names CUSTODIAL_KEY_ENCRYPTION_KEY when missing', () => {
    const result = loadChainConfig(buildValidEnv({ CUSTODIAL_KEY_ENCRYPTION_KEY: undefined }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('CUSTODIAL_KEY_ENCRYPTION_KEY')
    }
  })

  it('names QR_TOKEN_SECRET when missing', () => {
    const result = loadChainConfig(buildValidEnv({ QR_TOKEN_SECRET: undefined }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('QR_TOKEN_SECRET')
    }
  })
})

// Unit tests: QR_TOKEN_TTL_SECONDS behavior (unchanged from EVM era)

describe('loadChainConfig: QR_TOKEN_TTL_SECONDS', () => {
  it('defaults to 300 when QR_TOKEN_TTL_SECONDS is omitted', () => {
    const result = loadChainConfig(buildValidEnv({ QR_TOKEN_TTL_SECONDS: undefined }))
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.qrTokenTtlSeconds).toBe(300)
    }
  })

  it('defaults to 300 when QR_TOKEN_TTL_SECONDS is empty string', () => {
    const result = loadChainConfig(buildValidEnv({ QR_TOKEN_TTL_SECONDS: '' }))
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.qrTokenTtlSeconds).toBe(300)
    }
  })

  it('uses provided value when it is a valid positive integer', () => {
    const result = loadChainConfig(buildValidEnv({ QR_TOKEN_TTL_SECONDS: '600' }))
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.qrTokenTtlSeconds).toBe(600)
    }
  })

  it('names QR_TOKEN_TTL_SECONDS when value is zero', () => {
    const result = loadChainConfig(buildValidEnv({ QR_TOKEN_TTL_SECONDS: '0' }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('QR_TOKEN_TTL_SECONDS')
    }
  })

  it('names QR_TOKEN_TTL_SECONDS when value is negative', () => {
    const result = loadChainConfig(buildValidEnv({ QR_TOKEN_TTL_SECONDS: '-1' }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('QR_TOKEN_TTL_SECONDS')
    }
  })

  it('names QR_TOKEN_TTL_SECONDS when value is not an integer', () => {
    const result = loadChainConfig(buildValidEnv({ QR_TOKEN_TTL_SECONDS: '3.5' }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('QR_TOKEN_TTL_SECONDS')
    }
  })

  it('names QR_TOKEN_TTL_SECONDS when value is non-numeric', () => {
    const result = loadChainConfig(buildValidEnv({ QR_TOKEN_TTL_SECONDS: 'abc' }))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('QR_TOKEN_TTL_SECONDS')
    }
  })
})

// Unit tests: cross-field key derivation (new)

describe('loadChainConfig: cross-field PHPC_ISSUER_PUBLIC_KEY derivation', () => {
  it('names PHPC_ISSUER_PUBLIC_KEY when public key does not match derived from secret', () => {
    // Use a valid but mismatched public key (from a different keypair)
    const otherKp = Keypair.random()
    const result = loadChainConfig(
      buildValidEnv({ PHPC_ISSUER_PUBLIC_KEY: otherKp.publicKey() }),
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('PHPC_ISSUER_PUBLIC_KEY')
    }
  })

  it('does NOT attempt derivation when PHPC_ISSUER_SECRET is malformed', () => {
    // When the secret is bad, only PHPC_ISSUER_SECRET should be reported,
    // not PHPC_ISSUER_PUBLIC_KEY (unless the public key itself is also bad)
    const result = loadChainConfig(
      buildValidEnv({
        PHPC_ISSUER_SECRET: 'invalid-seed',
        PHPC_ISSUER_PUBLIC_KEY: FIXED_KEYPAIR.publicKey,
      }),
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toContain('PHPC_ISSUER_SECRET')
      // Public key is well-formed so should NOT be reported
      expect(invalidVariables).not.toContain('PHPC_ISSUER_PUBLIC_KEY')
    }
  })
})

// Preserved properties: collect ALL errors, never partial config

describe('loadChainConfig: collects ALL invalid variables into ONE error', () => {
  it('reports multiple simultaneous bad vars in one error', () => {
    const result = loadChainConfig(
      buildValidEnv({
        STELLAR_HORIZON_URL: undefined,
        STELLAR_NETWORK_PASSPHRASE: 'wrong',
        PHPC_ASSET_CODE: '',
      }),
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      expect(invalidVariables).toEqual(
        expect.arrayContaining([
          'STELLAR_HORIZON_URL',
          'STELLAR_NETWORK_PASSPHRASE',
          'PHPC_ASSET_CODE',
        ]),
      )
      expect(invalidVariables).toHaveLength(3)
    }
  })
})

describe('loadChainConfig: never returns a partial ChainConfig', () => {
  it('returns err with no partial config for multiple invalid fields', () => {
    const result = loadChainConfig({})
    expect(result.isErr()).toBe(true)
    // The result is either ok or err; there's no way to get a partial config
    // from the return type. We verify the error contains ALL expected fields.
    if (result.isErr()) {
      const invalidVariables = getInvalidVariables(result.error as ValidationError)
      // All required fields should appear (9 required env vars)
      expect(invalidVariables.length).toBeGreaterThanOrEqual(9)
    }
  })
})
