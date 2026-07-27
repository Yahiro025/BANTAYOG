---
inclusion: manual
---

# Testing Conventions

Vitest 2 everywhere (`environment: node`, `globals: true`); Hardhat for Solidity. Tests live
beside the code as `<name>.test.ts` — there is no separate `tests/` tree.

```bash
pnpm test                                  # turbo: all packages
pnpm --filter @bantayog/server test        # server unit + e2e-style tests
pnpm --filter @bantayog/web test           # lib/** and app/api/** only
pnpm --filter @bantayog/schema test
pnpm --filter @bantayog/db test
pnpm --filter @bantayog/contracts test     # hardhat test
```

`apps/web/vitest.config.ts` restricts `include` to `lib/**/*.test.ts` and `app/api/**/*.test.ts`
and aliases `@`, `@bantayog/schema`, `@bantayog/db` — component tests are not set up, so put
testable logic in `lib/`.

## Patterns already in the repo

- **Pure domain first.** `src/domain/*.test.ts` passes an explicit `currentDate` so tier/eligibility
  boundaries (1,000 days from conception, 730 from birth) are deterministic. Follow this instead of
  mocking timers.
- **Supabase is stubbed by hand.** Service tests build a fake client whose `from()` returns a
  chainable stub (see `beneficiary.service.test.ts`, `custodial-wallet.service.test.ts`). No
  test-DB dependency.
- **Result assertions.** Assert on `result.isOk()` / `result.isErr()` and the error `_tag` rather
  than expecting throws.
- **Route tests** exercise the Hono app via `app.request(...)` with fabricated Bearer tokens and
  mocked middleware; `app.test.ts` covers `/health` and 404 handling.
- **Property tests** use `fast-check` where value ranges matter.
- **DTO snapshots** live in `src/dto/__snapshots__/mappers.test.ts.snap` — update them
  deliberately, since they encode the public API shape.
- **`src/e2e/transaction-flow.test.ts`** is the closest thing to an integration test: full
  scan → cart → PIN → settle path with a mocked chain client. Extend it when changing checkout.
- **`src/static-checks/forbidden-references.test.ts`** walks the whole repo asserting that
  `Ronin | Tanto | Waypoint | SKY_MAVIS | 31337` appear only in allowlisted paths, and that the
  walk itself visited >100 files. Non-comment code matches fail the build; if you legitimately
  need a new exception, extend the allowlist with a reason comment.

## Expectations for new work

- Bug fix → add a regression test in the same file as the fix.
- New service method → cover the happy path plus each `err(...)` branch.
- New migration → update `packages/db/src/types.ts` and `packages/db/src/types.test.ts`.
- Contract change → `pnpm --filter @bantayog/contracts test`; keep UUPS storage-layout tests
  passing (`contracts/test/PHPCSubsidyV2Mock.sol`).
- Before presenting a change: `pnpm type-check` and the relevant `test` script. Lint runs with
  `--max-warnings 0`, so unused vars must be prefixed `_` or removed.
