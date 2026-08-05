# Project knowledge

This file gives Freebuff context about your project: goals, commands, conventions, and gotchas.
Filled in 2026-08-05 from `docs/`, `.kiro/steering/`, ADRs, and the `merchant-apk` worktree.

Note: this file is for Freebuff only. Do not reference it from AGENTS.md or other agent-facing  
docs. 

## Must Follow

Never read any .env file , private keys, API tokens, signing keystores.
Never deploy contracts, apply supabase migrations, sign APKs, or call production services.

## Project

BANTAYOG turns LGU nutrition cash grants into nutrition-locked subsidies for the Philippine
"First 1,000 Days" cohort (RA 11148). Guardians get a printed QR "Nutri-Pass"; credits spend
only on child-appropriate food at approved sari-sari stores; settlement records on Polygon
Amoy testnet (chain 80002) with a mock PHPC token. Team JUMBO HOTDOG; 1st Runner-Up SparkFest
2026; live pitch at Cryptita Plays Builder Showcase @ WOCEE 2026 on **August 8, 2026** (SMX
Manila). Testnet/demo-grade code, but the architecture is real (ADRs in `docs/adr/`).

## Quickstart

- Setup: `pnpm install` (pnpm 9.15.0 pinned in `packageManager`, Node &gt;= 20). Copy `.env.example`
→ root `.env`, `apps/server/.env`, `apps/web/.env.local`. Apply `supabase/migrations/*.sql` in
order (append-only). Contracts optional: `pnpm --filter @bantayog/contracts compile` + `pnpm deploy:contracts`.
- Dev: `pnpm dev` (turbo: web :3000 with `--webpack`, server :3001).
- Test: `pnpm test` — single package: `pnpm --filter @bantayog/<pkg> test` (schema, db, server,
web, contracts via Hardhat).
- Lint: `pnpm lint` (eslint, `--max-warnings 0` — unused vars must be `_`-prefixed or deleted).
- Types: `pnpm type-check` across the graph. Build: `pnpm build` (web = `next build`; server "build" is `tsc --noEmit`).
- Mobile APK: `pnpm --filter @bantayog/web build:mobile` (merchant-only static export to `apps/web/out`)
then `pnpm --filter @bantayog/mobile exec cap sync android`. Use `ANDROID_HOME=/home/yahiro/Android/Sdk`
and the Android Studio JBR 21 (`/opt/android-studio/jbr`), never the system JDK.
- Quality gate before presenting anything: `pnpm lint && pnpm type-check && pnpm test`.

## Architecture

- Key directories:
  - `apps/web` — Next.js 16 PWA, view layer only. Three surfaces sandboxed by hostname
  (`middleware.ts`): `/admin/*` (admin), merchant (`/merchant-login`, `/dashboard`, `/cart/*`,
  `/checkout/*`), `/balance` (public guardian view). `app/api/[...proxy]/route.ts` forwards
  `/api/*` to the server. No business logic here.
  - `apps/server` — Hono 4 API (port 3001), ALL business logic: `routes/` (zValidator + Zod,
  maps AppResult) → `services/` (orchestration, returns `AppResult<T>` from neverthrow) →
  `repositories/` (BaseRepository, one per table) → `domain/` (pure, injectable `currentDate`).
  `dto/mappers.ts` is the only snake_case→camelCase translation point. `lib/` holds errors,
  logger, redact, supabase, redis, gemini-client, chain/config.
  - `apps/mobile` — Capacitor 8.4.2 Android shell, lives in the `merchant-apk` worktree
  (namespace `ph.bantayog.merchant`, Java MainActivity, minSdk 24 / compile+target 36,
  AGP 8.13.0, Gradle 8.14.3).
  - `packages/schema` (Zod DTOs, `@bantayog/schema`), `packages/db` (Supabase `Database`
  types + BaseRepository, `@bantayog/db`), `packages/contracts` (Solidity + Hardhat 3),
  `packages/config` (tsconfig/eslint presets). Packages are consumed as source.
  - `supabase/migrations/` — 10 numbered append-only SQL files. `packages/db/src/types.ts` LAGS
  the migrations (verify against SQL, not types).
- Data flow:
  - Checkout (critical path): merchant POST `/api/transactions` → checks in fixed order
  (merchant APPROVED → QR JWS → `qr_passes.expires_at` → beneficiary status → PIN w/ lockout →
  total &gt; 0 → balance) → `settle_sale` RPC: `SELECT ... FOR UPDATE` beneficiary, deduct credit,
  credit merchant `wallet_balance`, insert transaction `CONFIRMED`, all in one transaction.
  - Chain settlement: outbox table + `POST /api/cron/reconcile` (3 attempts then FAILED +
  balance-restoration compensator). **Known gap:** live checkout writes no outbox row, so the
  reconcile queue stays empty after a real sale.
  - Scan: Gemini identifies (`blurry | unrecognized | identified`); the `products` catalog
  decides eligibility (ADR-003). Cart stores category; checkout maps it via
  `toNutritionCategory` (unknown → `OTHER`).
  - Admin: register beneficiary + child, compute tier dynamically (ADR-002, Tier 1 = 5,000 /
  Tier 2 = 3,500 one-time), print QR pass, approve merchants.

## Worktrees (merchant APK work)

- `BANTAYOG-worktrees/merchant-apk` on `feat/merchant-apk` — Urban APK development. Task 0
baseline Steps 1–7 build-verified; **stopped at Step 8 owner gate** (no commit yet; no Rural
worktree/branch). 55-file Android shell staged; `apps/mobile/package.json` +
`capacitor.config.ts` repaired (unstaged on top of zero-byte staged placeholders). Debug APK
exists but is **NOT release-functional**: Handoff Task 2 (absolute-HTTPS API base in the APK,
`wallet-adapter.ts` fix) is unimplemented. See
`docs/handoff/TASK_0_DEEPSEEK_FREEBUFF_HANDOFF.md`.
- `BANTAYOG-worktrees/merchant-apk-rural` on `codex/rural-merchant-apk` — Rural development,
**not yet created**; only after owner approves and records the shared baseline commit.
- ADR-004 (accepted, NOT implemented): Rural offline quota extension — signed permits (≤30 days,
stop sales 24h early, ≤7 distinct merchants/beneficiary, reservation-aware Postgres
settlement), offline PIN verifier (5-fail lockout, 200/500/3 pilot limits), QR pass v2 (ES256,
no HMAC), signed catalog releases, barcode-first + Gemini online fallback, sync of signed
events only, append-only conflict reviews, online-only cash-out. GCash/GoTyme/bank payouts are
future plans only. Implementation plan: `docs/superpowers/plans/2026-08-04-rural-offline-merchant-flow.md`.

## Conventions

- Formatting/linting: ESLint flat config (`--max-warnings 0`), Prettier-style TS 5.7. Files
kebab-case with role suffix (`*.service.ts`, `*.repository.ts`, `*.test.ts`). Server/packages
use relative imports with explicit `.js` extensions; web uses `@/…` aliases (declare in both
`tsconfig.json` and `vitest.config.ts`).
- Patterns to follow:
  - Route → service → repository. Services return `AppResult<T>` (neverthrow), never throw for an
  expected failure; routes map via `errorToHttpStatus` (7 tags: validation/auth/rateLimit/
  onchain/persistence/jwt/policy).
  - Parse, don't validate: `zValidator` + Zod schemas from `@bantayog/schema` at the boundary.
  - Domain logic pure with injectable `currentDate` (no `new Date()` inside).
  - Money: PHP `NUMERIC(12,2)`, integer credits, 1 credit = 1 PHPC = 1e18 wei. Money moves ONLY
  through `settle_sale` RPC. No floats in credit math.
  - Migrations append-only; mirror every change in `packages/db/src/types.ts` + `types.test.ts`;
  update DTO snapshot on purpose.
  - Ownership/requirement header comments on server files (`BE1 owns this file`,
  `Requirements 8.1, 8.2`).
  - Docs in ASD-STE100 Simplified Technical English (short, active sentences).
  - Stay on stack: viem (not ethers), Zustand (not Redux), `fetch` (not axios), Supabase client +
  repositories (no ORM), `@node-rs/argon2` PINs, `jose` JWS, pino logs.
- Things to avoid:
  - Business logic in `apps/web`; logic in the `/api/[...proxy]` route.
  - Editing an applied migration; `DB_RECORDED`/`BROADCAST` in `transactions.status` (CHECK
  allows only `PENDING_CHAIN | SUBMITTED | CONFIRMED | RECONCILED | FAILED`).
  - Mainnet keys/RPC; `Ronin`/`Tanto`/`Waypoint`/`SKY_MAVIS`/chain 31337 (static test fails).
  - Mutating endpoints under `/api/balance` (public by design).
  - Relying on `apps/web/lib/env.ts` dev fallbacks or the hardcoded `QR_TOKEN_SECRET` fallback.
  - Committing `.env*` (except `.env.example`), keystores, APKs/AABs; logging/returning secrets,
  PINs, PII, stack traces.
  - Raw hex colours in components — use tokens from `docs/context/DESIGN.md`.
  - `git commit`/`push`/`--force`/`reset --hard`/`clean -f` unless explicitly asked.

## Gotchas

- `packages/db/src/types.ts` lags SQL: missing `intervention_tier`, `total_amount`,
`outbox.last_error`; phantom `outbox.run_after`, `administrators`, `photo_receipts`,
`claim_outbox_rows`; wrong `TransactionStatus`; `market_prices` untyped.
- Known gaps (see `docs/context/PRD.md` §9): `qr_passes.revoked` only checked by verify-qr (a
revoked pass can still transact); QR tokens carry no `exp`; checkout response vs stored row
differ (`total_credit_deducted`, `idempotency_key`, `confirmed_at`, `stablecoin_amount_wei`
not persisted); Gemini `is_child_friendly`/`Draft`→`VEGETABLES` fallbacks must be removed
before offline plan; `docs/SECURITY.md` says no image storage but `products.image_url` stores
base64; Render free plan sleeps (cold start ~30–60 s looks like a network failure).
- Ask before: applying/editing migrations on a real Supabase project, deploying/upgrading
contracts, spending from `DEPLOYER_PRIVATE_KEY`, changing auth/RBAC/RLS, touching
`settle_sale` or the cash-out lock, adding dependencies (esp. native Android: Kotlin,
SQLCipher, WorkManager, ML Kit, OpenCV are a gated approval).

