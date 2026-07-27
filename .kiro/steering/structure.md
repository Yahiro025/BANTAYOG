---
inclusion: always
---

# Project Structure

pnpm workspace + Turborepo. `apps/*` are deployables, `packages/*` are shared code.

## Folder map

```
apps/web/                    Next.js 16 PWA — UI only, no business logic
  app/                       App Router. Route groups: (auth), (merchant), admin/, balance/
    api/[...proxy]/          Edge proxy: /api/* -> API server
    sw.ts                    Serwist service worker source
  components/{admin,merchant,ui,shared}/
  lib/                       api.ts (authFetch), env.ts, db.ts, anon-photo-store.ts,
                             chain/, qr/, services/, domain/, middleware/, merchant/, supabase/
  stores/                    Zustand stores + auth-context.tsx
  hooks/  providers/         React hooks and app-level providers
  middleware.ts              hostname sandboxing + admin route guard

apps/server/                 Hono 4 API — all business logic
  src/app.ts                 app factory: CORS -> logger -> rate limit -> per-group auth/RBAC -> routes
  src/index.ts               node-server entry (:3001)
  src/routes/                one file per resource; cron/ subfolder for scheduled endpoints
  src/services/              orchestration; return AppResult<T>
  src/repositories/          thin BaseRepository subclasses, one per table
  src/domain/                pure functions (eligibility/tier, nutrition policy)
  src/data/                  static reference data (market-prices.data.ts)
  src/dto/mappers.ts         row -> DTO mapping (snake_case -> camelCase) + snapshot tests
  src/lib/                   errors, logger, redact, supabase, redis, gemini-client, chain/config
  src/types/env.ts           typed env bindings for Hono
  src/cron/                  reconcile.ts (outbox worker), tier-reeval.ts
  src/e2e/  src/static-checks/

packages/schema/             Zod DTOs + inferred types (@bantayog/schema)
packages/db/                 Supabase Database types, BaseRepository, clients (@bantayog/db)
packages/contracts/          Solidity + Hardhat 3 (PHPC, PHPCSubsidy, registries, UUPSProxy)
packages/config/             shared tsconfig presets + flat ESLint config
packages/ui/                 placeholder, empty — web components live in apps/web/components

supabase/migrations/         numbered SQL migrations; seed.sql, setup-test-users.js
scripts/                     seeding + external cron registration
docs/                        SECURITY.md, SMART_CONTRACT_OPS.md, adr/001-003
```

## Naming conventions

- Files: kebab-case, with a role suffix — `*.service.ts`, `*.repository.ts`, `*.gateway.ts`,
  `*.test.ts`, `*.machine.ts`, `*.data.ts`. Route files are the bare resource name
  (`transactions.ts`). React components are kebab-case files exporting PascalCase components.
- DB columns are snake_case with unit/format suffixes (`monthly_income_php`,
  `mobile_number_e164`, `stablecoin_amount_wei`, `pin_hash_argon2id`). API DTOs are camelCase —
  translation happens in `src/dto/mappers.ts`, nowhere else.
- Status enums are SCREAMING_SNAKE (`PENDING_CHAIN`, `APPROVED`), except `products.eligibility_status`
  which is lowercase `eligible | ineligible` (legacy; keep it).
- Server files carry an ownership/requirement header comment (`BE1 owns this file`,
  `Requirements 8.1, 8.2`). Preserve and extend that style when editing.

## Import conventions

- Server/packages: relative imports with explicit `.js` extension (`./lib/errors.js`),
  workspace imports as `@bantayog/db` / `@bantayog/schema`.
- Web: `@/lib/*`, `@/components/*`, `@/stores/*`, `@/hooks/*`, `@/providers/*`, `@/app/*` aliases
  (declared in both `tsconfig.json` and `vitest.config.ts` — update both when adding one).
- Packages export from `src/index.ts` and are consumed as source (`main` points at `src/index.ts`);
  there is no build artifact to import.

## Architectural rules

1. **Web is a view layer.** All decisions (eligibility, tiers, balances, settlement) happen in
   `apps/server`. Web calls `/api/*` through `authFetch`, which attaches the merchant localStorage
   token first and falls back to the Supabase session.
2. **Route → service → repository.** Routes validate with `zValidator` + Zod, services orchestrate
   and return `AppResult<T>`, repositories extend `BaseRepository<'table'>` for typed CRUD.
   Cross-cutting reads sometimes use `createServiceClient()` directly in a route — acceptable for
   simple lookups, but new business logic belongs in a service.
3. **Errors are values.** Seven tagged errors (`validation, auth, rateLimit, onchain, persistence,
   jwt, policy`) map to stable HTTP codes via `errorToHttpStatus`. Never leak stack traces or PII.
4. **Domain logic is pure.** `src/domain/*` takes an injectable `currentDate` and has no I/O, so
   tier math stays testable and identical across read paths.
5. **Atomicity lives in Postgres.** Money moves via the `settle_sale` RPC (row lock + balance
   checks + insert in one transaction). Do not re-implement multi-step balance math in TS.
6. **Chain writes are deferred.** Off-chain balances are the source of truth for UX; on-chain
   settlement happens through the `outbox` table + reconcile cron and at merchant cash-out
   (ADR-001).
7. **Migrations are append-only.** Add a new numbered file; never edit an applied one. Mirror the
   change in `packages/db/src/types.ts` (`Database` interface + row types) in the same change.
8. `apps/web/lib/domain/*` duplicates parts of `apps/server/src/domain/*` for client-side display.
   Server copies win; if you change a rule, change both or delete the client copy.
