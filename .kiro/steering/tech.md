---
inclusion: always
---

# Technology Stack

## Runtimes & tooling

- Node >= 20, pnpm 9.15.0 (`packageManager` is pinned — do not use npm/yarn), Turborepo 2.
- TypeScript 5.7 everywhere, ESM (`"type": "module"` in server/packages). Server and package
  imports use explicit `.js` extensions on relative paths; `apps/web` does not (Next resolves).
- Solidity 0.8.28, Hardhat 3 with `@nomicfoundation/hardhat-toolbox-viem` (viem, not ethers).

## Frameworks & major libraries

| Area | Choice |
| --- | --- |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, Zustand 5, TanStack Query 5 + Table 8, react-hook-form + zod resolvers |
| PWA | `@serwist/next` (service worker built from `apps/web/app/sw.ts`, production builds only) |
| QR | `react-qr-code` (generate), `html5-qrcode` / `@zxing/browser` (scan), `html-to-image` (pass export) |
| API | Hono 4 on `@hono/node-server`, `@hono/zod-validator`, pino logging |
| Errors | `neverthrow` — services return `Promise<AppResult<T>>`; handlers `.match()` at the HTTP boundary |
| Validation | Zod 4 DTOs in `@bantayog/schema`, shared by server and web |
| Data | Supabase (Postgres + Auth + Storage), `@supabase/supabase-js`, `@supabase/ssr` on web |
| Cache/limits | Upstash Redis + `@upstash/ratelimit` sliding window |
| Crypto | `@node-rs/argon2` (Argon2id PINs), `jose` (JWS QR tokens), node `crypto` (AES-256-GCM wallet keys) |
| AI | `@google/genai` (Gemini vision + grounded research) via `apps/server/src/lib/gemini-client.ts` |
| Chain | viem 2, OpenZeppelin 5 (UUPS), XState 5 for the transaction lifecycle machine |
| Tests | Vitest 2 (`environment: node`), `fast-check` for property tests |

## Exact commands

```bash
pnpm install                      # install workspace
pnpm dev                          # turbo dev: web :3000, server :3001
pnpm build                        # turbo build (server build = tsc --noEmit)
pnpm test                         # turbo test (vitest run in each package)
pnpm lint                         # eslint, --max-warnings 0
pnpm type-check                   # tsc --noEmit across the graph

pnpm --filter @bantayog/web test          # single-package variants
pnpm --filter @bantayog/server test
pnpm --filter @bantayog/contracts compile
pnpm --filter @bantayog/contracts test
pnpm deploy:contracts             # compile + hardhat run scripts/deploy.ts --network amoy
pnpm setup:cron                   # register cron-job.org jobs against the Railway API
```

Prefer `pnpm --filter <pkg> <script>` over `cd`-ing into a package.

## Infra

- **Web**: Next.js app; `/api/[...proxy]` edge route forwards everything under `/api/*` to the
  API server (`NEXT_PUBLIC_API_BASE_URL`, default the Railway deployment). The web app holds no
  business logic.
- **Server**: Hono on Railway, `PORT` env (3001 local). `GET /health` is public.
- **DB**: Supabase Postgres, migrations in `supabase/migrations/*.sql` (numbered, additive,
  `IF NOT EXISTS`-style). Extensions in use: `pgvector`, `pg_trgm`. Server code uses the service
  role client and therefore bypasses RLS — RLS is defense in depth, not the only gate.
- **Cron**: external scheduler (cron-job.org) hits `POST /api/cron/reconcile` and
  `/api/cron/tier-reeval` with `Authorization: Bearer $CRON_SECRET`.
- **Env**: root `.env` + `.env.example`, `apps/server/.env`, `apps/web/.env.local`,
  `packages/contracts/.env`. `turbo.json#globalEnv` lists every var that must be declared for
  cache correctness — add new vars there too.

## Technical constraints

- Stay on the listed libraries. No ethers (viem only), no Redux (Zustand), no axios (`fetch`),
  no ORM (Supabase client + repositories).
- Services never throw for expected failures — return `err(new ...Error())` from
  `apps/server/src/lib/errors.ts` and let the route map it to a status.
- No new runtime dependency without a clear need; pin versions in the same style as existing
  entries.
- Chain config is loaded and validated only through `apps/server/src/lib/chain/config.ts`
  (`loadChainConfig`), which rejects localhost RPC URLs and reports every invalid var at once.
  Do not read chain env vars ad hoc.
- A repo-wide static test forbids reintroducing `Ronin` / `Tanto` / `Waypoint` / `SKY_MAVIS` /
  chain id `31337` outside allowlisted files
  (`apps/server/src/static-checks/forbidden-references.test.ts`). Keep new code Polygon-only.
- Deeper reference material lives beside this file and is loaded on demand:
  `/context add .kiro/steering/<api-surface|data-model|blockchain|security|testing|frontend>.md`.

## Known repo-level drift

- Root `package.json` `description` still says "mock PHPC on Ronin Saigon testnet"; the code
  targets Polygon Amoy. Stale metadata, not behavior.
- `packages/db/src/types.ts` lags the SQL migrations in several places — see `data-model.md` for
  the verified table of differences before trusting those types.
- `apps/web` pins `vitest ^2.1.8` alongside `@vitest/coverage-v8 ^4.1.9`; coverage runs may
  complain until one of them is aligned.
