# RULES — coding and implementation rules for BANTAYOG

Written in ASD-STE100 Simplified Technical English.

These rules apply to every change in this repository. They keep the code maintainable, scalable,
simple and reliable. Read `ARCHITECTURE.md` for the structure. Read this file for the discipline.

## 0. Rule 0 — consistency beats purity

The conventions in the repository win over every rule below. Read the neighbouring file first.
Match its structure, its naming, its error handling and its layering. If a rule here asks for a
different style than the file you edit, follow the file and say so in the pull request. Never
refactor unrelated code to satisfy a principle.

### Order of precedence when rules conflict

1. **Correctness and security.** Never trade these away.
2. **Rule 0.** Consistency is a form of correctness.
3. **Clarity.** The reader's time is worth more than the writer's time.
4. **KISS and YAGNI.** These beat speculative SOLID scaffolding.
5. **DRY.** This beats repetition, but it loses to clarity.
6. **Performance.** Only with a measurement.

## 1. KISS — keep it simple

- Use the plainest construct that solves the problem. Use a function before a class. Use a literal
  before a factory. Use a `switch` before a registry.
- One function does one level of abstraction. Do not mix orchestration and byte handling in one
  body.
- Prefer a platform feature over a dependency. Prefer one dependency over three. Every new
  dependency needs a stated reason and a pinned version.
- Keep a service method short enough to read on one screen. If you cannot, extract a step.

## 2. YAGNI — you are not going to need it

- Build only what the current requirement needs.
- Do not add a config flag, a plugin point, a generic parameter or an interface with one
  implementation and no second caller.
- Delete dead code. Do not comment it out.
- Do not add a database column "for later". A migration is cheap. A wrong column is not.

## 3. DRY — the rule of three

- Duplicate a piece of logic twice. Extract it on the third use.
- Extract knowledge, not coincidental similarity. Two blocks that look alike but change for
  different reasons stay separate.
- These items must have exactly one home:

| Knowledge | Home |
| --- | --- |
| Tier and eligibility rules | `apps/server/src/domain/*` |
| Money movement | the `settle_sale` RPC |
| Error to HTTP status | `lib/errors.ts` (`errorToHttpStatus`) |
| Row to DTO translation | `dto/mappers.ts` |
| Chain configuration | `lib/chain/config.ts` (`loadChainConfig`) |
| Request and response shapes | `packages/schema` |
| Design tokens | `apps/web/app/globals.css` |

- `apps/web/lib/domain/*` duplicates some server rules for display. This is a known exception. If
  you change a rule, change the server copy first, then the client copy, or delete the client copy.

## 4. SOLID

The repository is mostly functional. Read each letter as a rule for a module or a function too.

| Letter | Rule | How this repo applies it |
| --- | --- | --- |
| **S** — single responsibility | One reason to change per unit. If the file description needs "and", split the file | One service per resource. One repository per table. A route validates and maps. It does not decide |
| **O** — open for extension | Add a new case, handler or implementation. Do not edit a `switch` that many callers depend on | Add a new tagged error and map it in `errorToHttpStatus`. Add a new outbox `kind`. Do not change the meaning of an existing one |
| **L** — substitution | An alternate implementation honours the base contract. No stronger precondition, no weaker postcondition, no surprise throw | Every `*.repository.ts` extends `BaseRepository<'table'>` and keeps its return shape. A repository never throws where the base returns a value |
| **I** — interface segregation | Depend on the narrowest surface you use | Pass `currentDate: Date`, not a clock service. Pass the one repository a service needs, not a container of all of them |
| **D** — dependency inversion | Policy depends on an abstraction. Inject clients, clocks, randomness and I/O | A service takes the Supabase client in its constructor. A domain function takes `currentDate`. `BlockchainClient.create(config)` receives a validated config |

## 5. Separation of concerns

```
apps/web            renders. Decides nothing
  ↓ /api/*
routes/             HTTP only. zValidator in, status code out
  ↓
services/           orchestration. Returns AppResult<T>. No Hono type
  ↓
repositories/       rows in, rows out. No policy
  ↓
Postgres            constraints and settle_sale
domain/             pure rules. No I/O. Called from services
```

Hard boundaries:

1. `apps/web` holds no eligibility, tier, balance or settlement decision.
2. `app/api/[...proxy]/route.ts` only forwards. Never add logic there.
3. A service never imports a Hono type. A route never holds a business rule.
4. A domain function never reads the clock, the network or the database.
5. `dto/mappers.ts` is the only place that translates `snake_case` to `camelCase`.

## 6. Fail fast

- Validate at the system boundary. Use `zValidator` with a Zod schema from `@bantayog/schema`.
- **Parse, do not validate.** Convert untrusted input into a precise type once, at the edge. The
  rest of the code trusts the type.
- Reject invalid configuration at startup. `loadChainConfig` reports every invalid variable in one
  error and never returns a partial config. Copy this pattern for a new config loader.
- No silent fallback. No `catch {}` that swallows an error. No default that hides a missing
  variable. The hardcoded `QR_TOKEN_SECRET` fallback in `QrTokenService` is a bug, not a pattern.

## 7. Errors are values

- An expected failure returns `err(new ...Error())` from `lib/errors.ts`. It never throws.
- Reserve `throw` for a genuine bug.
- A new service method returns `Promise<AppResult<T>>`. The route calls `.match()` and maps the
  error with `errorToHttpStatus`.
- The seven tags are `validation`, `auth`, `rateLimit`, `onchain`, `persistence`, `jwt` and
  `policy`. Reuse a tag. Add a new one only with a mapped status code.
- An error message carries enough context to diagnose the failure. It never carries a PIN, a key,
  PII or a stack trace.

## 8. POLA — the principle of least astonishment

- A function behaves as its name promises. No hidden side effect. No argument mutation.
- Sibling functions share an order of parameters, a naming style and a return shape.
- Command and query stay separate. A function returns data, or it causes an effect.
- Names carry intent and units: `monthly_income_php`, `stablecoin_amount_wei`,
  `mobile_number_e164`, `pin_hash_argon2id`.
- A boolean reads as a predicate. A function reads as a verb. A collection reads as a plural.
- Do not use a boolean parameter that makes the call site unreadable. Pass a named option.

## 9. Total functions and honest types

- Handle every case. Use an exhaustive `switch`. Do not use a non-null assertion to silence the
  compiler.
- Make an illegal state unrepresentable. A database CHECK is a type: `amount_phpc IN (5000, 3500)`
  and `credit_balance >= 0` make a bad row impossible.
- Do not widen a type to make a compile error go away. Fix the shape, or fix
  `packages/db/src/types.ts` (see the drift table in `SCHEMA.md`).

## 10. Purity and immutability

- Push I/O to the edges. Keep the deciding core pure.
- A domain function receives `currentDate: Date`. It never calls `new Date()` or `Date.now()`.
- Prefer `const`, `readonly` and a new value over an in-place change.
- Keep mutable state in the smallest scope.

## 11. Money, concurrency and idempotency

These rules protect public funds. They are not negotiable.

1. Money is PHP with 2 decimals. The column type is `NUMERIC(12,2)`. Credits are integers.
   1 credit = 1 PHPC = 1e18 wei. No float holds money.
2. Money moves only through the `settle_sale` RPC. Never reproduce the lock, the checks and the
   insert in TypeScript.
3. Assume two requests arrive at the same moment. Guard shared state with a row lock, a conditional
   update or a database constraint. Never with a read-then-write gap.
4. Any retryable operation is safe to retry. Use an idempotency key and a UNIQUE constraint. The
   checkout id **is** the idempotency key. `allocations.beneficiary_id` is UNIQUE for the same
   reason.
5. A multi-step state change belongs in one transaction, or it needs an explicit compensating
   action. `restoreBeneficiaryBalance` plus the `BALANCE_RESTORATION_AUDIT` outbox row is the
   compensator on the chain path.
6. Design for the failure mode. State the timeout, the retry bound and the degraded behaviour. The
   reconcile cron retries 3 times, then marks the row `FAILED`.

## 12. Security

- **Least privilege.** Grant the narrowest scope and the shortest lifetime. Default to deny.
- **Authorize on the server.** `requireRole` at the route group, plus an explicit ownership check
  in the handler for merchant-scoped data.
- **Defence in depth.** A route guard does not excuse a missing ownership check or a missing
  database constraint. RLS stays correct even though the service role key bypasses it.
- **Never trust the client.** The tier, the allocation amount and the eligibility never come from a
  request body.
- **Secrets.** Never log or return a secret, a PIN, a private key, PII or a stack trace. Use
  `collectConfiguredSecrets` plus `redactSecrets` around chain operations. Never commit `.env*`
  except `.env.example`.
- **Testnet only.** Polygon Amoy, chain id 80002. Never wire a mainnet key or a mainnet RPC.

## 13. Observability

- Log a decision and a failure with a request id and structured fields.
- Redact by key name and by value.
- A failure must be diagnosable from the logs alone.
- Do not log an image, a full request body or a token.

## 14. Testing

- Code that is hard to test is coupled too tightly. Inject the dependency. Do not mock the world.
- Test the observable behaviour, not the implementation.
- Cover the happy path, every `err(...)` branch and the boundaries: empty, zero, one, maximum,
  off by one, concurrent.
- Every bug fix gets a regression test in the same file as the fix.
- Tests are deterministic. Inject time and randomness. No sleep. No live network. No shared
  mutable fixture. No order dependence.
- Update the DTO snapshot on purpose. It is the public API contract.

## 15. Change discipline

- One concern per change. Separate a refactor from a behaviour change.
- Leave the campsite cleaner, inside your scope. Fix the thing you touched. Do not rewrite the
  neighbourhood.
- A migration is append-only after it is applied. Evolve forward with a new numbered file, and
  mirror the change in every place that declares the shape.
- Record a decision with a real trade-off as an ADR in `docs/adr/`. Update the matching document in
  `docs/context/` or `.kiro/steering/` in the same change.
- Ask for confirmation before you apply a migration to a real project, deploy or upgrade a
  contract, spend from `DEPLOYER_PRIVATE_KEY`, change auth, RBAC or RLS, or touch `settle_sale` or
  the cash-out lock.

## 16. Definition of done

Before you present a change, confirm each line and state what you could not confirm:

1. `pnpm lint` passes with 0 warnings.
2. `pnpm type-check` passes.
3. The package test script passes: `pnpm --filter @bantayog/<pkg> test`.
4. Every input is parsed at the boundary.
5. Every error branch returns a value, not a throw.
6. No secret, PIN, key, PII or stack trace can reach a client or a log.
7. A second concurrent caller cannot break the change.
8. Money math uses integers or `NUMERIC(12,2)`, never a float.
9. The change contains nothing that the requirement did not ask for.
10. The affected document is updated: `SCHEMA.md`, `ARCHITECTURE.md`, `DESIGN.md`, an ADR or a
    steering file.

## 17. Anti-patterns — reject these in review

| Anti-pattern | Correct approach |
| --- | --- |
| Balance math in TypeScript | The `settle_sale` RPC |
| A business rule in `apps/web` | A service in `apps/server` |
| Logic in `app/api/[...proxy]/route.ts` | A route in `apps/server` |
| `throw` for an expected failure | `return err(new ...Error())` |
| A new tagged error with no status mapping | Add the mapping to `errorToHttpStatus` |
| Reading `process.env.POLYGON_AMOY_RPC_URL` directly | `loadChainConfig(process.env)` |
| `new Date()` inside a domain function | An injected `currentDate` |
| A raw hex colour in a component | A token from `DESIGN.md` |
| A mutating endpoint under `/api/balance` | A guarded route in another group |
| Editing an applied migration | The next numbered migration file |
| A local copy of a DTO shape | An import from `@bantayog/schema` |
| An interface with one implementation and no second caller | The concrete function |
