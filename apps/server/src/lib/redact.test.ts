import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { redactSecrets, collectConfiguredSecrets } from './redact'

// Arbitraries

// Four distinct, non-empty secret strings, none of which is a substring of
// another. Filtering out substring relationships keeps the test's failure
// modes easy to reason about: each `not.toContain` assertion below targets
// exactly one secret's own literal text, not a side effect of another
// secret's redaction also removing it.
const secretsArb = fc
  .tuple(
    fc.string({ minLength: 8, maxLength: 40 }).filter((s) => s.trim().length > 0),
    fc.string({ minLength: 8, maxLength: 40 }).filter((s) => s.trim().length > 0),
    fc.string({ minLength: 8, maxLength: 40 }).filter((s) => s.trim().length > 0),
    fc.string({ minLength: 8, maxLength: 40 }).filter((s) => s.trim().length > 0),
  )
  .filter(([s1, s2, s3, s4]) => {
    const all = [s1, s2, s3, s4]
    return all.every((s, i) => all.every((other, j) => i === j || !other.includes(s)))
  })

// Builds a nested structure embedding the four secrets at various positions.
function structureArb(secret1: string, secret2: string, secret3: string, secret4: string) {
  return fc.record({
    topLevel: fc.constant(secret1),
    nested: fc.record({
      deep: fc.constant(secret2),
    }),
    inArray: fc.array(fc.constant(secret3), { minLength: 1, maxLength: 3 }),
    // Secret embedded as a substring inside a larger, unrelated string —
    // the main scenario pino's key-based redaction cannot catch.
    inMessage: fc
      .string()
      .map((s) => `Error: something went wrong with ${secret4} during processing (${s})`),
    unrelated: fc.string(),
  })
}

// Property 14: Secrets are redacted from all serialized output

describe('redactSecrets', () => {
  // Feature: polygon-amoy-phpc-migration, Property 14: Secrets are redacted from all serialized output
  // Validates: Requirements 6.5, 10.4
  it('never lets a configured secret value appear in the serialized output', () => {
    fc.assert(
      fc.property(
        secretsArb.chain(([secret1, secret2, secret3, secret4]) =>
          fc.tuple(
            fc.constant(secret1),
            fc.constant(secret2),
            fc.constant(secret3),
            fc.constant(secret4),
            structureArb(secret1, secret2, secret3, secret4),
          ),
        ),
        ([secret1, secret2, secret3, secret4, structure]) => {
          const redacted = redactSecrets(structure, [secret1, secret2, secret3, secret4])
          const serialized = JSON.stringify(redacted)

          expect(serialized).not.toContain(secret1)
          expect(serialized).not.toContain(secret2)
          expect(serialized).not.toContain(secret3)
          expect(serialized).not.toContain(secret4)

          // Explicitly targets the "secret embedded as a substring inside an
          // unrelated string" scenario — the documented value proposition of
          // redactSecrets over pino's key-name-based redaction.
          expect((redacted as { inMessage: string }).inMessage).not.toContain(secret4)
          expect((redacted as { inMessage: string }).inMessage).toContain('[REDACTED]')
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('collectConfiguredSecrets', () => {
  it('collects all five Stellar secrets plus extras in order', () => {
    const result = collectConfiguredSecrets(
      {
        issuerSecret: 'issuer-key',
        distributionSecret: 'dist-key',
        sponsorSecret: 'sponsor-key',
        keyEncryptionKey: 'enc-key',
        qrTokenSecret: 'qr-key',
      },
      'extra1',
    )

    expect(result).toEqual([
      'issuer-key',
      'dist-key',
      'sponsor-key',
      'enc-key',
      'qr-key',
      'extra1',
    ])
  })

  it('filters out empty/falsy configured values', () => {
    const result = collectConfiguredSecrets({
      issuerSecret: 'issuer-key',
      distributionSecret: '',
      sponsorSecret: 'sponsor-key',
      keyEncryptionKey: '',
      qrTokenSecret: 'qr-key',
    })

    expect(result).toEqual(['issuer-key', 'sponsor-key', 'qr-key'])
  })

  it('includes extra secrets appended via rest args', () => {
    const result = collectConfiguredSecrets(
      {
        issuerSecret: 'a',
        distributionSecret: 'b',
        sponsorSecret: 'c',
        keyEncryptionKey: 'd',
        qrTokenSecret: 'e',
      },
      'extra1',
      'extra2',
    )

    expect(result).toEqual(['a', 'b', 'c', 'd', 'e', 'extra1', 'extra2'])
  })
})
