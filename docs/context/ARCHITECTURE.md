# ARCHITECTURE — BANTAYOG

Written in ASD-STE100 Simplified Technical English.

This file describes the system as the code is now. The decision records in `docs/adr/` hold the
reasons. Read this file for structure. Read an ADR for a trade-off. Section 8 lists the places
where an ADR and the code disagree.

## 1. Top-level system overview

```
                        ┌──────────────────────────────┐
                        │  Guardian: printed Nutri-Pass│
                        │  (paper QR, no login)        │
                        └───────────────┬──────────────┘
                                        │ scan
┌───────────────┐   ┌───────────────────▼──────────────────┐   ┌──────────────────┐
│ LGU admin     │   │  apps/web — Next.js 16 PWA           │   │ Merchant phone   │
│ browser       ├──►│  one deployment, three surfaces,     │◄──┤ (low-end Android)│
└───────────────┘   │  sandboxed by hostname              │   └──────────────────┘
                    │  /admin/*  /dashboard  /balance      │
                    │  view layer only — no business logic │
                    └───────────────┬──────────────────────┘
                                    │ /api/* through app/api/[...proxy]
                                    ▼
                    ┌──────────────────────────────────────┐
                    │  apps/server — Hono 4 API (Render)   │
                    │  routes → services → repositories    │
                    │  domain/* stays pure                 │
                    └──┬────────────┬─────────────┬────────┘
                       │            │             │
            ┌──────────▼───┐  ┌─────▼──────┐  ┌───▼─────────────┐
            │ Supabase     │  │ Gemini     │  │ Polygon Amoy    │
            │ Postgres     │  │ vision +   │  │ chain id 80002  │
            │ Auth Storage │  │ grounded   │  │ PHPC, PHPCSubsidy│
            │ settle_sale  │  │ price      │  │ viem clients    │
            └──────┬───────┘  └────────────┘  └───▲─────────────┘
                   │ outbox rows                  │
                   │                              │
            ┌──────▼──────────────────────────────┴──┐
            │ external scheduler (cron-job.org)      │
            │ POST /api/cron/reconcile               │
            │ POST /api/cron/tier-reeval             │
            └────────────────────────────────────────┘
```

Money is off-chain first. The database holds the truth for the user interface. The chain holds the
public record. ADR-001 gives the reason.

## 2. Deployment view

| Component | Runtime | Notes |
| --- | --- | --- |
| `apps/web` | Next.js 16, port 3000 | PWA with a Serwist service worker. `/~offline` is the fallback document. Dev runs with `--webpack` |
| `apps/mobile` | Capacitor 8.4.2 Android APK | Bundles a merchant-only static export of `apps/web`. Origin `https://localhost`, starts at `/merchant-login`, opens with no network. No middleware and no `/api` proxy, so it calls the API with an absolute URL and needs `https://localhost` in `CORS_ORIGIN`. See ADR-005 |
| `apps/server` | Hono on `@hono/node-server`, port 3001 | `GET /health` is public |
| Database | Supabase Postgres | Extensions `pgvector` and `pg_trgm` |
| Cache and limits | Upstash Redis | Sliding-window rate limits and the PIN lockout |
| Chain | Polygon Amoy testnet | Read every chain variable through `loadChainConfig` |
| Scheduler | cron-job.org | Sends `Authorization: Bearer $CRON_SECRET` |

`apps/web/app/api/[...proxy]/route.ts` forwards `/api/*` to `NEXT_PUBLIC_API_BASE_URL`. It
forwards the method, the body (`duplex: 'half'`) and only the `authorization` and `content-type`
headers. Add server logic to `apps/server`, never to the proxy.

## 3. Layers

```
apps/server/src/
  app.ts            middleware stack + route registration
  routes/           HTTP boundary. Validates with zValidator. Maps AppResult to a status
  services/         orchestration. Returns AppResult<T>. No HTTP types
  repositories/     one class per table. Extends BaseRepository<'table'>
  domain/           pure functions. Injectable currentDate. No I/O
  dto/mappers.ts    snake_case row to camelCase DTO. The only translation point
  lib/              errors, logger, redact, supabase, redis, gemini-client, chain/config
  cron/             reconcile.ts (outbox worker), tier-reeval.ts
```

Rules:

1. A route never talks to Supabase for a business decision. A simple cross-cutting read is
   acceptable, and `createServiceClient()` appears in some routes for that reason.
2. A service never imports a Hono type and never throws for an expected failure.
3. A repository holds no policy. It reads and writes rows.
4. A domain function has no I/O. It receives `currentDate` as an argument.
5. `apps/web` holds no decision. `apps/web/lib/domain/*` duplicates some rules for display only.
   The server copy wins.

### Middleware order (`app.ts`)

```
CORS (CORS_ORIGIN, default http://localhost:3000)
  → pino request logger
    → global rate limit, 100 per 60 s per IP
      → endpoint rate limits (login 5, merchant-login 5, verify-pin 3, vision 10)
        → per-route-group authMiddleware + requireRole(...)
          → route handler
            → notFound (404 not_found) / onError (500 internal_error)
```

`authMiddleware` never rejects. It verifies the Bearer token and sets `c.get('user')` to
`{id, email, role}` or `null`. `requireRole` rejects: 401 with no user, 403 with the wrong role.
`GET /health` and `/api/balance/*` carry no guard by design.

## 4. Design methodology

| Practice | How the repo applies it |
| --- | --- |
| Specification first | Server files carry an ownership and requirement header, for example `BE1 owns this file` and `Requirements 8.1, 8.2`. Keep and extend this style |
| Decision records | A trade-off gets an ADR in `docs/adr/`. Code comments point back to the requirement |
| Append-only migrations | A schema change adds the next numbered SQL file. Nobody edits an applied file |
| Types as contracts | Zod schemas in `@bantayog/schema` are shared by the server and the web app. DTO snapshots lock the public shape |
| Test beside the code | `<name>.test.ts` sits next to the file. There is no separate test tree |
| One gate | `pnpm lint && pnpm type-check && pnpm test` must pass before a pull request |

## 5. Design patterns in use

| Pattern | Where | Why |
| --- | --- | --- |
| Result / Either | `AppResult<T>` from `neverthrow`, in every service | An expected failure is a value, not an exception. `errorToHttpStatus` maps seven tagged errors to stable codes |
| Repository | `repositories/*.repository.ts` on `BaseRepository<'table'>` | Keeps SQL access typed and in one layer. No ORM |
| Transactional outbox | `outbox` table plus `cron/reconcile.ts` | Separates the instant sale from the slow chain write (ADR-001) |
| Pure domain core | `domain/eligibility.ts`, `domain/nutrition-policy.ts` | Tier math is deterministic and identical on every read path (ADR-002) |
| Gateway / adapter | `services/chain.client.ts`, `wallet-adapter.gateway.ts`, `lib/gemini-client.ts` | Isolates viem, `personal_sign` and Gemini behind one narrow surface |
| Anti-corruption layer | `dto/mappers.ts` | Database naming never leaks into the API. The snapshot test guards the shape |
| Idempotency key | `transactions.idempotency_key` UNIQUE, and the key is the row id | A retried checkout cannot double spend |
| Database-level atomicity | `settle_sale` RPC with `SELECT ... FOR UPDATE` | One transaction does the lock, the checks and the insert |
| Conditional-update lock | `merchants.cashout_in_progress` | Stops two concurrent cash-outs without a distributed lock |
| Policy at the boundary | `requireRole` plus explicit ownership checks | RLS is defence in depth, because the server uses the service role key |
| State machine (descriptive) | `services/transaction.machine.ts` (XState) | Documents the intended lifecycle. The routes do not drive it today |

## 6. Data flows

### 6.1 Checkout — the critical path

```
merchant app                server                          Postgres
     │  POST /api/transactions  │                              │
     │  qrToken, pin, items,    │                              │
     │  idempotencyKey          │                              │
     ├─────────────────────────►│ 1 merchant is APPROVED       │
     │                          │ 2 verify JWS QR token        │
     │                          │ 3 qr_passes.expires_at       │
     │                          │ 4 beneficiary not SUSPENDED  │
     │                          │   and not INELIGIBLE         │
     │                          │ 5 PIN, Argon2id + lockout    │
     │                          │ 6 total > 0                  │
     │                          │ 7 total <= credit_balance    │
     │                          ├─ settle_sale(...) ──────────►│ FOR UPDATE lock
     │                          │                              │ credit down
     │                          │                              │ merchant up
     │                          │                              │ insert CONFIRMED
     │                          │◄─────────── transaction id ──┤
     │◄──── 201 + DTO +         │ builds the DTO in memory     │
     │      remainingBalance    │ no outbox row is written     │
```

The order of steps 1 to 7 is fixed. Do not reorder it. Step 3 does not check
`qr_passes.revoked`; that is a known gap.

Two facts about this route that surprise a reader:

1. **The live checkout writes no outbox row.** `routes/transactions.ts` calls `settle_sale` and
   returns. Only `TransactionService.createTransaction` inserts a `TRANSACTION_CHAIN_SUBMIT` row,
   and no route calls that method today. The reconcile worker therefore has nothing to drain from a
   real sale. See section 8.
2. **The response is assembled in memory.** The route builds `txRow` from local variables and does
   not read the inserted row back. The response carries `totalCreditDeducted`, `idempotencyKey`,
   `confirmedAt` and `stablecoinAmountWei: '0'`, but `settle_sale` does not persist those four
   columns. The API answer and the stored row differ.

### 6.2 Chain settlement — `POST /api/cron/reconcile`

The worker is complete and correct. Nothing fills its queue on the live path today. Read the note
in section 6.1 first.

```
scheduler ─► Bearer CRON_SECRET ─► runReconciliation()
  1. loadChainConfig(process.env)          → stop on any invalid variable
  2. BlockchainClient.create(config)
  3. select up to 20 outbox rows           status = PENDING, kind = TRANSACTION_CHAIN_SUBMIT
  4. per row: update status = PROCESSING   (a claim, one row at a time)
  5. read merchants.wallet_address
  6. chainClient.transferPHPC(wallet, wei) treasury → merchant, a plain ERC-20 transfer
  7. waitForConfirmation(txHash)
  8. success → outbox DONE, transaction CONFIRMED + onchain_tx_hash + confirmed_at
     failure → attempts + 1, last_error, status back to PENDING
               at 3 attempts → outbox FAILED, transaction FAILED,
               restoreBeneficiaryBalance() writes BALANCE_RESTORATION_AUDIT
```

The compensator is a safety net. The live checkout path deducts credit inside `settle_sale` and
never before a confirmation, so the current path does not reach it with a pre-deducted balance.

### 6.3 Allocation

```
admin ─► POST allocation trigger ─► computeTier(currentDate)  → 1 or 2
                                  → amount 5000 or 3500 from the tier
                                  → insert allocations row (beneficiary_id UNIQUE)
                                  → chain allocateCredits, wait up to 60 s
```

The amount always comes from the computed tier. The request body never sets it.

### 6.4 Product scan

```
merchant photo ─► POST /api/vision/analyze-scan
  Gemini → blurry | unrecognized | identified
         → child-friendly verdict, flagged ingredients, category, researched PHP base price
  identified → ProductsService.validateOrCreateProduct
             → price range = base ± 10, eligibility_status from the verdict,
               category defaults to 'Draft' when unknown
  the products row decides eligibility — never the model reply (ADR-003)
```

### 6.5 Balance view

```
printed pass ─► /balance?token=... ─► GET /api/balance/view
  invalid or expired token → invalid_pass
  no beneficiary           → 404 not_matched
  retrieval failure        → 503 temporarily_unavailable
  success                  → name, balance, up to 50 transactions, newest first
```

This route is public and read-only. Never add a mutating endpoint under `/api/balance`.

## 7. Cross-cutting concerns

| Concern | Implementation |
| --- | --- |
| Errors | Seven tagged errors in `lib/errors.ts`: `validation` 400, `auth` 403 (401 when expired), `rateLimit` 429, `onchain` 502, `persistence` 500, `jwt` 401, `policy` 422. Some handlers add ad-hoc tags (`not_found`, `forbidden`, `conflict`, `invalid_pass`) |
| Logging | pino with a request id. Key redaction in `lib/logger.ts`. Value redaction in `lib/redact.ts` with `collectConfiguredSecrets` |
| Configuration | `loadChainConfig` validates every chain variable and reports all failures in one error. It never returns a partial config |
| Money | `NUMERIC(12,2)` in Postgres. Integer credits. 1 credit = 1 PHPC = 1e18 wei. Cash-out keeps centavos with `BigInt(Math.round(amount * 100)) * 10n ** 16n` |
| Secrets | `DEPLOYER_PRIVATE_KEY` stays on the server. Custodial beneficiary keys are AES-256-GCM ciphertext at rest |
| Offline | Serwist precaches the build manifest and serves `/~offline` |

## 8. Where the ADRs and the code differ

Fix the document or fix the code. Do not leave both wrong.

| ADR | Statement | Code today |
| --- | --- | --- |
| ADR-001 | "settled on-chain on the Ronin blockchain" | Polygon Amoy, chain id 80002. A static test blocks the old names |
| ADR-001 | The handler writes the transaction and the outbox row in one atomic step | The live checkout route writes no outbox row at all. `TransactionService.createTransaction` writes one, but no route calls it. Only the e2e test drives that path |
| ADR-001 | The handler writes the transaction as `PENDING_CHAIN`, and checkout returns `PENDING_CHAIN` | `settle_sale` inserts the row as `CONFIRMED`. The route returns `CONFIRMED` |
| ADR-001 | The contract de-duplicates with the transaction UUID | The reconcile cron sends a plain treasury-to-merchant transfer. It does not call `processTransaction` |
| ADR-002 | — | Matches the code. `computeTier` runs on read, at scan time and in the nightly cron |
| ADR-003 | Trigram fuzzy match against `products` | Matches the code for `/classify`. `/analyze-scan` upserts a draft row instead |
| `docs/adr/001-transactional-outbox.md` | — | The file starts with a stray `there's` before the title. Delete those characters |

The `transactions.status` CHECK allows five values. The code writes only three:
`PENDING_CHAIN` (in `TransactionService`), `CONFIRMED` (`settle_sale` and the cron) and `FAILED`
(the cron). Nothing writes `SUBMITTED` or `RECONCILED`. One status therefore cannot tell an
off-chain settlement apart from a chain confirmation.

## 9. Contracts (`packages/contracts`)

| Contract | Role |
| --- | --- |
| `PHPC.sol` | Mock PHP-pegged ERC-20, 18 decimals. The subsidy unit |
| `PHPCSubsidy.sol` | UUPS-upgradeable subsidy logic. `onlyOwner` on `allocateCredits` and `processTransaction` |
| `BeneficiaryRegistry.sol`, `MerchantRegistry.sol` | Kept from the earlier design. Not part of the PHPC settlement path |
| `UUPSProxy.sol`, `test/PHPCSubsidyV2Mock.sol` | Proxy plumbing and the storage-layout test fixture |

Hardhat 3, solc 0.8.28, optimizer runs 200, `evmVersion: london`. Keep a V2 storage layout
identical to V1. The runbook is `docs/SMART_CONTRACT_OPS.md`.

## 10. Adding a feature — the standard path

1. Add or extend a Zod schema in `packages/schema`.
2. Add the pure rule to `apps/server/src/domain` with an injectable `currentDate`.
3. Add the orchestration to a service. Return `AppResult<T>`.
4. Add the row access to a repository.
5. Add the route with `zValidator` and the correct `requireRole`.
6. Map the row to a DTO in `dto/mappers.ts`. Update the snapshot on purpose.
7. Add tests: the happy path and every `err(...)` branch.
8. If the schema changed, add the next migration and mirror it in `packages/db/src/types.ts`.
9. Update `SCHEMA.md`, this file or the matching `.kiro/steering/*.md` file.
