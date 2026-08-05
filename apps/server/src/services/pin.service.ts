import { hash, verify } from '@node-rs/argon2'
import { type AppResult, ok, err, ValidationError, RateLimitError } from '../lib/errors.js'
import { getRedisClient } from '../lib/redis.js'

// Requirement 7.5: number of consecutive incorrect PIN attempts that triggers
// a lockout.
const MAX_CONSECUTIVE_FAILURES = 5

// Requirement 7.5: lockout duration (and failure-counter TTL) in seconds.
const LOCKOUT_TTL_SECONDS = 900

// Redis key prefixes for the PIN lockout state (design.md "PIN Lockout State
// (Upstash Redis)"):
// pin_fail:{beneficiaryId} — consecutive failure counter
// pin_lock:{beneficiaryId} — lock flag, set once the counter reaches
// MAX_CONSECUTIVE_FAILURES, TTL LOCKOUT_TTL_SECONDS
const FAIL_KEY_PREFIX = 'pin_fail:'
const LOCK_KEY_PREFIX = 'pin_lock:'

// BE1-2.3 · PIN Service
// Handles Argon2id hashing and verification of 6-digit PINs.
export class PinService {
  // Hashes a 6-digit PIN using Argon2id.
  async hashPin(pin: string): Promise<AppResult<string>> {
    try {
      const hashed = await hash(pin);
      return ok(hashed);
    } catch (error: any) {
      return err(new ValidationError(`PIN hashing failed: ${error.message}`));
    }
  }

  // Verifies a 6-digit PIN against an Argon2id hash.
  async verifyPin(pin: string, hashString: string): Promise<AppResult<boolean>> {
    try {
      const isValid = await verify(hashString, pin);
      return ok(isValid);
    } catch (error: any) {
      return err(new ValidationError(`PIN verification failed: ${error.message}`));
    }
  }

  // Verifies a submitted PIN with consecutive-failure lockout tracking.
// Requirement 7.3: verifies the submitted PIN against the stored hash.
// Requirement 7.4: a wrong PIN is reported as an authentication failure
// without mutating any balance (handled by the caller; this method only
// reports success/failure).
// Requirement 7.5: after MAX_CONSECUTIVE_FAILURES (5) consecutive incorrect
// attempts, further purchase PIN attempts for that beneficiary are blocked
// for LOCKOUT_TTL_SECONDS (900) and reported as a `RateLimitError`.
// Redis state (design.md "PIN Lockout State (Upstash Redis)"):
// pin_fail:{beneficiaryId} — consecutive failure counter, TTL refreshed
// to 900s on every increment
// pin_lock:{beneficiaryId} — lock flag set with a 900s TTL once the
// failure counter reaches 5
// If Upstash Redis is not configured, lockout enforcement is skipped
// entirely (graceful pass-through, matching this codebase's established
// Upstash-optional convention) and PIN verification still proceeds via
// `verifyPin`.
  async verifyPinWithLockout(
    beneficiaryId: string,
    pin: string,
    hashString: string,
  ): Promise<AppResult<boolean>> {
    const redis = getRedisClient();

    if (!redis) {
      // Upstash not configured: no lockout enforcement, PIN verification
      // itself still works.
      return this.verifyPin(pin, hashString);
    }

    const failKey = `${FAIL_KEY_PREFIX}${beneficiaryId}`;
    const lockKey = `${LOCK_KEY_PREFIX}${beneficiaryId}`;

    const lockedOut = await redis.exists(lockKey);
    if (lockedOut) {
      return err(
        new RateLimitError(
          'Too many incorrect PIN attempts. Account is temporarily locked.',
          LOCKOUT_TTL_SECONDS,
        ),
      );
    }

    const verifyResult = await this.verifyPin(pin, hashString);
    if (verifyResult.isErr()) {
      return verifyResult;
    }

    const isValid = verifyResult.value;

    if (isValid) {
      // Reset lockout state on a successful verification.
      await redis.del(failKey, lockKey);
      return ok(true);
    }

    // Wrong PIN: increment the consecutive-failure counter.
    const attempts = await redis.incr(failKey);

    if (attempts >= MAX_CONSECUTIVE_FAILURES) {
      await redis.set(lockKey, '1', { ex: LOCKOUT_TTL_SECONDS });
      await redis.del(failKey);
      return err(
        new RateLimitError(
          'Too many incorrect PIN attempts. Account is temporarily locked.',
          LOCKOUT_TTL_SECONDS,
        ),
      );
    }

    // Refresh the counter's TTL so stale failures don't linger indefinitely.
    await redis.expire(failKey, LOCKOUT_TTL_SECONDS);
    return ok(false);
  }
}

