# AGENTS.md

<!--
File: AGENTS.md at your project (git) root.
Codex CLI walks from the git root down to your cwd, reading one AGENTS.md per directory
(deeper ones override/add to shallower ones) — so put shared rules here and
package-specific overrides in e.g. /apps/server/AGENTS.md.
Global personal rules go in ~/.codex/AGENTS.md (or ~/.codex/AGENTS.override.md to
temporarily override it).
Keep this under ~150 lines — every token here loads on every turn.
-->

## Must Follow 
When writing plans or documentation use: 
ASD-STE100 Simplified Technical English(STE for short)

Read also everything under docs/ , .kiro/steering directories

## Project

BANTAYOG turns LGU nutrition cash grants into nutrition-locked subsidies for the Philippine
"First 1,000 Days" cohort: guardians get a printed QR "Nutri-Pass", credits are spent only on
child-appropriate food at approved sari-sari stores, and settlement is recorded on Polygon Amoy
testnet with a mock PHPC token. pnpm workspace + Turborepo: `apps/web` (Next.js 16 PWA, view
layer only), `apps/server` (Hono 4 API, all business logic), `apps/mobile` (Capacitor 8 Android
shell bundling a merchant-only static export of `apps/web`), `packages/{schema,db,contracts,config}`,
`supabase/migrations`.

The project is entered in the Cryptita Plays Builder Showcase at WOCEE 2026 (live pitch
August 8, 2026, SMX Convention Center Manila, *Bayanihan Finance* category). Event facts, the
category choice and the stage scope live in `docs/SHOWCASE.md` — keep them there, and do not add
features "for the demo".

## Setup & commands

- Install: `pnpm install` (pnpm 9.15.0 is pinned in `packageManager`; Node >= 20)
- Dev: `pnpm dev` (turbo: web on :3000 with `--webpack`, server on :3001)
- Test: `pnpm test` — single package: `pnpm --filter @bantayog/server test`,
  `--filter @bantayog/web test`, `--filter @bantayog/schema test`, `--filter @bantayog/db test`,
  `--filter @bantayog/contracts test` (Hardhat)
- Lint: `pnpm lint` (eslint, `--max-warnings 0` — unused vars must be `_`-prefixed or deleted)
- Build: `pnpm build` (web = `next build`; server "build" is `tsc --noEmit`, so it emits nothing)
- Types: `pnpm type-check` across the graph
- Contracts: `pnpm --filter @bantayog/contracts compile`; deploy via `pnpm deploy:contracts` (Amoy)
- Android APK: `pnpm --filter @bantayog/web build:mobile` (merchant-only static export) then
  `pnpm --filter @bantayog/mobile exec cap sync android`; live reload with
  `pnpm --filter @bantayog/mobile dev:emulator`. Export `ANDROID_HOME` and build with the Android
  Studio JBR 21, not the system JDK. See `docs/MOBILE_BUILD.md` and `docs/adr/005-merchant-android-packaging.md`

Env lives in root `.env`, `apps/server/.env`, `apps/web/.env.local`, `packages/contracts/.env`.
New vars must also be added to `turbo.json#globalEnv` or the cache goes stale.

## Working agreements

- Always run `pnpm type-check` and the package's `test` script after modifying anything under
  `apps/server/src`, `packages/schema`, or `packages/db` — those three are consumed as source.
- Always mirror a new `supabase/migrations/*.sql` file in `packages/db/src/types.ts` (`Database`
  interface + row types) and `packages/db/src/types.test.ts` in the same change. `types.ts` already
  lags the SQL in several places — verify against the migrations, not the types.
- Always update `src/dto/__snapshots__/mappers.test.ts.snap` deliberately when a DTO shape changes;
  that snapshot is the public API contract.
- Route → service → repository. Routes validate with `zValidator` + Zod schemas from
  `@bantayog/schema`; services return `AppResult<T>` (`neverthrow`); repositories extend
  `BaseRepository<'table'>`. Domain logic in `apps/server/src/domain/*` stays pure and takes an
  injectable `currentDate`.
- Prefer `pnpm --filter <pkg> add <dep>` when installing dependencies; pin in the existing style.
  Stay on the current stack: viem (not ethers), Zustand (not Redux), `fetch` (not axios),
  Supabase client + repositories (no ORM).
- Relative imports in `apps/server` and `packages/*` carry explicit `.js` extensions; `apps/web`
  uses `@/…` aliases declared in both `tsconfig.json` and `vitest.config.ts` (update both).
- Ask for confirmation before: applying or editing migrations against a real Supabase project,
  deploying or upgrading contracts, spending from `DEPLOYER_PRIVATE_KEY`, changing auth/RBAC or
  RLS policies, and touching `settle_sale` or the cash-out lock.
- Deeper reference docs are in `docs/context/` (`PRD`, `ARCHITECTURE`, `SCHEMA`, `DESIGN`, `RULES`),
  `.kiro/steering/` (`api-surface`, `data-model`, `blockchain`, `security`, `frontend`, `testing`)
  and `docs/adr/001-003`. Read `docs/context/SCHEMA.md` before a schema change, `DESIGN.md` before a
  UI change, and `RULES.md` before a new service or route.

## Repository expectations

- Run `pnpm lint && pnpm type-check && pnpm test` before opening a pull request. Contract changes
  additionally need `pnpm --filter @bantayog/contracts test` with UUPS storage-layout tests passing.
- Add a regression test in the same file as every bug fix; cover the happy path plus each `err(...)`
  branch for a new service method.
- Document behaviour changes where the repo already keeps them: an ADR in `docs/adr/` for
  decisions with real trade-offs, `docs/SECURITY.md` / `docs/SMART_CONTRACT_OPS.md` for security and
  ops changes, and the matching `.kiro/steering/*.md` file so the described behaviour stays true.
  Several docs are aspirational today — fix the doc or the code, don't leave both wrong silently.
- Preserve the ownership/requirement header comments on server files (`BE1 owns this file`,
  `Requirements 8.1, 8.2`) and extend that style in new files.
- Keep money exact: PHP with 2 decimals, `NUMERIC(12,2)`, integer credits, `1 credit = 1e18 wei`.
  No floats in credit math.
- Naming: files kebab-case with a role suffix (`*.service.ts`, `*.repository.ts`, `*.gateway.ts`);
  DB columns snake_case with unit suffixes; DTOs camelCase, translated only in `src/dto/mappers.ts`.

## Never do

- Never edit an applied migration. Schema changes are append-only: add the next numbered file.
- Never put business logic in `apps/web` — no eligibility, tier, balance, or settlement decisions
  client-side, and nothing beyond forwarding in `app/api/[...proxy]/route.ts`.
- Never re-implement multi-step balance math in TypeScript. Money moves only through the
  `settle_sale` Postgres RPC (row lock + checks + insert in one transaction).
- Never write `DB_RECORDED` or `BROADCAST` to `transactions.status`; the CHECK allows only
  `PENDING_CHAIN | SUBMITTED | CONFIRMED | RECONCILED | FAILED`.
- Never wire a mainnet key or mainnet RPC. Polygon Amoy (80002) only, and read chain env vars only
  through `loadChainConfig` in `apps/server/src/lib/chain/config.ts`.
- Never reintroduce `Ronin` / `Tanto` / `Waypoint` / `SKY_MAVIS` / chain id `31337` outside the
  allowlist — `apps/server/src/static-checks/forbidden-references.test.ts` fails the build.
- Never throw for an expected failure. Return `err(new …Error())` from `apps/server/src/lib/errors.ts`
  and let the route map it via `errorToHttpStatus`.
- Never add mutating capability under `/api/balance` — it is intentionally public, authorized only
  by the signed QR token.
- Never commit `.env*` (except `.env.example`), never log or return secrets, PINs, private keys, PII,
  or stack traces; use `collectConfiguredSecrets` + `redactSecrets` around chain operations.
- Never rely on `apps/web/lib/env.ts` dev fallbacks (random JWT/QR secrets, Hardhat account #0) or
  the hardcoded `QR_TOKEN_SECRET` fallback in `QrTokenService` for anything deployed.
- Never `git commit`, `git push`, `--force`, `reset --hard`, or `clean -f` unless explicitly asked.
