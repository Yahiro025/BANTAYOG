// Error taxonomy with neverthrow Result types.
// Per BANTAYOG_PROJECT_PLAN.md §9 (F9 resolution):
// - Every service returns Promise<AppResult<T>>
// - Route handlers never throw
// - Result.match at the HTTP boundary maps each error type to a stable HTTP code
// BE1 owns this file; review by all.
import { Result, ok, err } from 'neverthrow'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

// Error classes (7 typed errors)

export class ValidationError {
  readonly _tag = 'validation' as const
  constructor(
    public readonly message: string,
    public readonly details?: unknown,
  ) {}
}

export class AuthError {
  readonly _tag = 'auth' as const
  constructor(
    public readonly message: string,
    public readonly code: 'invalid_credentials' | 'expired' | 'forbidden' = 'forbidden',
  ) {}
}

export class RateLimitError {
  readonly _tag = 'rateLimit' as const
  constructor(
    public readonly message: string,
    public readonly retryAfterSeconds: number = 60,
  ) {}
}

export class OnchainError {
  readonly _tag = 'onchain' as const
  constructor(
    public readonly message: string,
    public readonly code: number,
    public readonly txHash?: string,
  ) {}
}

export class PersistenceError {
  readonly _tag = 'persistence' as const
  constructor(
    public readonly message: string,
    public readonly table?: string,
  ) {}
}

export class JwtError {
  readonly _tag = 'jwt' as const
  constructor(
    public readonly message: string,
    public readonly reason: 'expired' | 'invalid' | 'revoked' = 'invalid',
  ) {}
}

export class PolicyError {
  readonly _tag = 'policy' as const
  constructor(
    public readonly message: string,
    public readonly rule?: string,
  ) {}
}

// Union type

export type AppError =
  | ValidationError
  | AuthError
  | RateLimitError
  | OnchainError
  | PersistenceError
  | JwtError
  | PolicyError

export type AppResult<T> = Result<T, AppError>

// Re-export neverthrow helpers for convenience

export { ok, err }

// HTTP status mapping

// Maps an AppError to its stable HTTP status code.
// Used at the HTTP boundary in route handlers.
export function errorToHttpStatus(error: AppError): ContentfulStatusCode {
  switch (error._tag) {
    case 'validation':
      return 400
    case 'auth':
      return error.code === 'expired' ? 401 : 403
    case 'rateLimit':
      return 429
    case 'onchain':
      return 502
    case 'persistence':
      return 500
    case 'jwt':
      return 401
    case 'policy':
      return 422
    default:
      return 500
  }
}

// Maps an AppError to a user-visible JSON response body.
// Never leaks internal stack traces or PII.
export function errorToResponseBody(error: AppError): {
  error: string
  message: string
  details?: unknown
} {
  return {
    error: error._tag,
    message: error.message,
    ...(error._tag === 'validation' && (error as ValidationError).details
      ? { details: (error as ValidationError).details }
      : {}),
  }
}
