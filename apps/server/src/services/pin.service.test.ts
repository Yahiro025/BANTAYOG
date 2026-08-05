import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { PinService } from './pin.service.js'

// Task 11.5 file-placement note: `PinService.verifyPinWithLockout` (the
// Redis-backed consecutive-failure lockout logic, Requirement 7.5) is
// entirely MOCKED-OUT in `routes/transactions.test.ts` (its
// `mockVerifyPinWithLockout` stub), so the REAL lockout counting logic can
// only be exercised here, directly against `PinService`. This mock targets
// `../lib/redis.js` (the thing `PinService` actually calls), not
// `PinService` itself.
//
// Safety check performed before adding this mock: today, with no Upstash
// env vars configured in the test environment, `getRedisClient()` already
// returns `null`, so `verifyPinWithLockout` isn't exercised by the existing
// tests in this file at all — they only call `hashPin`/`verifyPin`, which
// never touch Redis. Adding this mock therefore does not change the
// behavior/outcome of the existing 3 tests above; it only enables a
// previously-untested path (this file had no lockout test before).
vi.mock('../lib/redis.js', () => {
  const store = new Map<string, string>()
  return {
    getRedisClient: () => ({
      exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
      incr: vi.fn(async (key: string) => {
        const current = Number(store.get(key) ?? '0') + 1
        store.set(key, String(current))
        return current
      }),
      set: vi.fn(async (key: string, val: string, _opts: unknown) => {
        store.set(key, val)
      }),
      del: vi.fn(async (...keys: string[]) => {
        keys.forEach((k) => store.delete(k))
      }),
      expire: vi.fn(async () => { }),
    }),
  }
})

describe('PinService', () => {
  const pinService = new PinService()

  it('hashes a 6-digit PIN and verifies successfully', async () => {
    const pin = '123456'
    const hashResult = await pinService.hashPin(pin)

    expect(hashResult.isOk()).toBe(true)
    const hashed = hashResult._unsafeUnwrap()
    expect(hashed).toBeDefined()
    expect(hashed).not.toBe(pin)

    const verifyResult = await pinService.verifyPin(pin, hashed)
    expect(verifyResult.isOk()).toBe(true)
    expect(verifyResult._unsafeUnwrap()).toBe(true)
  })

  it('rejects incorrect PINs during verification', async () => {
    const pin = '123456'
    const wrongPin = '654321'
    const hashResult = await pinService.hashPin(pin)

    expect(hashResult.isOk()).toBe(true)
    const hashed = hashResult._unsafeUnwrap()

    const verifyResult = await pinService.verifyPin(wrongPin, hashed)
    expect(verifyResult.isOk()).toBe(true)
    expect(verifyResult._unsafeUnwrap()).toBe(false)
  })
})

// Property 16: PIN hashing/verification round-trip

//
// Scoping note: the full Property 16 statement (design.md) also mentions
// the recorded balance staying unchanged. `PinService` has no concept of a
// beneficiary balance at all — that's owned by the purchase route handler
// (`apps/server/src/routes/transactions.ts`, task 11.2). This test therefore
// scopes Property 16 to what `PinService` itself is responsible for: the
// Argon2id hash/verify round-trip contract (Requirements 7.3, 7.4). The
// balance-invariance half of the property is covered at the route level by
// tasks 11.6/11.7's property tests.
describe('Property 16: PIN hashing/verification round-trip', () => {
  // Feature: polygon-amoy-phpc-migration, Property 16: PIN hashing/verification round-trip
  // Validates: Requirements 7.3, 7.4
  it('verifying the original PIN against its own hash returns true, and verifying any different PIN returns false', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[0-9]{6}$/), // 6-digit PIN
        fc.stringMatching(/^[0-9]{6}$/), // a second, potentially-different 6-digit PIN
        async (pin, otherPin) => {
          const pinService = new PinService()
          const hashResult = await pinService.hashPin(pin)
          expect(hashResult.isOk()).toBe(true)
          if (!hashResult.isOk()) return
          const hashed = hashResult.value

          // The original PIN must always verify successfully.
          const selfVerify = await pinService.verifyPin(pin, hashed)
          expect(selfVerify.isOk()).toBe(true)
          expect(selfVerify.isOk() && selfVerify.value).toBe(true)

          // A different PIN must verify as false (skip when the generator
          // happens to produce the same PIN twice, which is a valid but
          // uninteresting case for the "different PIN" assertion).
          if (otherPin !== pin) {
            const otherVerify = await pinService.verifyPin(otherPin, hashed)
            expect(otherVerify.isOk()).toBe(true)
            expect(otherVerify.isOk() && otherVerify.value).toBe(false)
          }
        },
      ),
      { numRuns: 20 },
    )
  }, 120000)
})

// Property 17: PIN lockout after five consecutive failures

//
// File-placement note (Task 11.5): the task was originally scoped to
// `transactions.test.ts`, but `PinService.verifyPinWithLockout` is entirely
// mocked-out there (see `mockVerifyPinWithLockout` in that file) — it never
// calls into the real Redis-backed counting logic. That file is therefore
// the wrong place to validate the actual lockout behavior; it can only
// assert that the ROUTE correctly reacts to a `RateLimitError` returned by
// the (mocked) PinService, which is already covered by the existing 429
// unit test there ("returns 429 when the PIN is locked out..."). This test
// instead exercises the real `verifyPinWithLockout` method directly, with
// only its Redis dependency faked (see the `vi.mock('../lib/redis.js', ...)`
// above), which is the correct place to prove the 5-failure lockout
// invariant actually holds.
describe('Property 17: PIN lockout after five consecutive failures', () => {
  // Feature: polygon-amoy-phpc-migration, Property 17: PIN lockout after five consecutive failures
  // Validates: Requirements 7.5
  it('locks out after exactly 5 consecutive wrong-PIN attempts and reports RateLimitError', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[0-9]{6}$/), // correct PIN
        fc.stringMatching(/^[0-9]{6}$/), // wrong PIN
        fc.uuid(), // distinct beneficiary id per run so counters don't leak across runs
        async (correctPin, wrongPin, beneficiaryId) => {
          fc.pre(correctPin !== wrongPin)

          const pinService = new PinService()
          const hashResult = await pinService.hashPin(correctPin)
          expect(hashResult.isOk()).toBe(true)
          if (!hashResult.isOk()) return
          const hash = hashResult.value

          for (let i = 0; i < 4; i++) {
            const result = await pinService.verifyPinWithLockout(beneficiaryId, wrongPin, hash)
            expect(result.isOk()).toBe(true)
            expect(result.isOk() && result.value).toBe(false)
          }

          // 5th consecutive failure triggers the lock.
          const fifthResult = await pinService.verifyPinWithLockout(beneficiaryId, wrongPin, hash)
          expect(fifthResult.isErr()).toBe(true)

          // A subsequent attempt (even with the CORRECT pin) is blocked while locked.
          const sixthResult = await pinService.verifyPinWithLockout(beneficiaryId, correctPin, hash)
          expect(sixthResult.isErr()).toBe(true)
        },
      ),
      { numRuns: 20 },
    )
  }, 120000)
})
