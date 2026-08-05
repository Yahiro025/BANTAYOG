// Pino structured logger.
// BE1 owns this file. Structured logging with request_id correlation
// is wired up in P5 (T-5.2). For P1, this provides a basic logger interface.
// Redaction: pino's `redact.paths` below handles key-name-based redaction —
// it strips fields whose *key* matches a known-sensitive name (e.g. `pin`,
// `privateKey`) regardless of value. That alone can't catch a secret that
// ends up in a field it doesn't recognize (e.g. embedded inside an error
// message, or nested under an unexpected key). For that, `redactSecrets`
// (re-exported below from `./redact`) scans for known secret *values* and
// replaces them wherever they occur. Call sites that handle secret-bearing
// objects (e.g. `CustodialWalletService`, `ChainConfig`-derived data) should
// apply `redactSecrets(payload, collectConfiguredSecrets(config))` before
// passing the payload to `logger.info/warn/error`.
import pino from 'pino'

export { redactSecrets, collectConfiguredSecrets } from './redact'

const isDev = process.env.NODE_ENV === 'development'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'pin',
      'pin_hash',
      'pin_hash_argon2id',
      'password',
      'privateKey',
      'authorization',
      'token',
      '*.pin',
      '*.pin_hash',
      '*.pin_hash_argon2id',
      '*.password',
      '*.privateKey',
      '*.authorization',
      '*.token'
    ],
    censor: '[REDACTED]'
  },
  ...(isDev ? {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true
      }
    }
  } : {})
})

export type Logger = typeof logger

