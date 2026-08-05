// Value-based secret redaction.
// Complements pino's key-name-based `redact.paths` (see `./logger.ts`),
// which only redacts fields whose *key* matches a known-sensitive name
// (e.g. `pin`, `privateKey`). This module instead scans for known-sensitive
// *values* (e.g. the literal deployer private key, a beneficiary's
// decrypted key, the QR signing secret, the key-encryption key) wherever
// they appear — including nested objects, arrays, or embedded inside an
// unrelated string such as an error message — and replaces every exact
// occurrence with a fixed redaction marker.
// Requirements: 6.5, 10.4

const REDACTION_MARKER = '[REDACTED]'

// Escapes regex metacharacters so a secret can be safely used as a pattern.
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Scans `value` (recursively, through objects/arrays/strings) and replaces
// any exact occurrence of a string in `secrets` with a fixed redaction
// marker. Returns a deep-cloned, redacted copy; does not mutate `value`.
// Empty/falsy secret strings are filtered out first — redacting on an empty
// string would corrupt every string in the output.
export function redactSecrets<T>(value: T, secrets: readonly string[]): T {
  const nonEmptySecrets = secrets.filter((s): s is string => Boolean(s))

  if (nonEmptySecrets.length === 0) {
    return cloneWithout(value)
  }

  const pattern = new RegExp(
    nonEmptySecrets.map(escapeRegExp).join('|'),
    'g',
  )

  return redactValue(value, pattern) as T
}

function redactValue(value: unknown, pattern: RegExp): unknown {
  if (typeof value === 'string') {
    return value.replace(pattern, REDACTION_MARKER)
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, pattern))
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      result[key] = redactValue((value as Record<string, unknown>)[key], pattern)
    }
    return result
  }

  // Numbers, booleans, null, undefined, functions, symbols, bigint: no
  // secret string value could match a non-string type, return as-is.
  return value
}

// Deep-clones `value` without applying any redaction (no secrets to redact).
function cloneWithout<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneWithout(item)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      result[key] = cloneWithout((value as Record<string, unknown>)[key])
    }
    return result as T
  }
  return value
}

// Returns the list of "known secret values" currently configured, sourced
// from a loaded `ChainConfig` (issuer secret, distribution secret, sponsor
// secret, key-encryption key, QR token secret) plus any additional ad-hoc
// secrets (e.g. a beneficiary's decrypted private key during a signing
// operation) passed in explicitly.
export function collectConfiguredSecrets(
  config: {
    issuerSecret: string
    distributionSecret: string
    sponsorSecret: string
    keyEncryptionKey: string
    qrTokenSecret: string
  },
  ...extra: string[]
): string[] {
  return [
    config.issuerSecret,
    config.distributionSecret,
    config.sponsorSecret,
    config.keyEncryptionKey,
    config.qrTokenSecret,
    ...extra,
  ].filter(Boolean)
}
