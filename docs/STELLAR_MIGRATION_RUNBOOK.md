# Stellar Migration Runbook

Implementation instructions for migrating BANTAYOG's chain layer from Polygon Amoy to Stellar.

- **Decision record:** `docs/adr/004-stellar-migration.md`. That document explains *why*. This
  one explains *how*, in the order the work must happen.
- **Superseded:** `docs/adr/001-*` (deferred chain settlement on Polygon) and
  `docs/SMART_CONTRACT_OPS.md`.
- **Scope:** classic Stellar assets only. Soroban is Phase 8 and is explicitly out of scope for
  Phases 0 through 7.
- **Network:** Stellar testnet only. No mainnet key, no mainnet Horizon URL, at any phase.

## How to use this document

Each phase below has the same six sections: Goal, Files, Steps, Tests, Exit criteria, Rollback.
Work one phase at a time and finish it completely before starting the next. Every phase ends
green on the full quality gate, so a broken build is always attributable to the phase you are
currently in.

Run this before declaring any phase complete:

```bash
pnpm lint            # eslint, --max-warnings 0
pnpm type-check      # tsc --noEmit across the graph
pnpm test            # vitest in every package
```

If a phase cannot end green, stop and fix it rather than carrying breakage forward.

Two gates sit outside the phase sequence and are easy to skip by accident. The **data cutover
decision** must be made before Phase 3, because it determines whether the Phase 3 migration can
apply at all. The **acceptance verification** runs after Phase 6 and before Phase 7, because
Phase 7 is mostly deletion and is the hardest phase to reverse.

## Status

> Updated 2026-08-05 after code-level audit. Previous status (2026-08-04) was stale.

| Phase | Title | Status |
| --- | --- | --- |
| 0 | Prep and baseline | Complete |
| 1 | Asset bootstrap | Complete |
| - | Data cutover decision | Complete (Option A: reset demo cohort) |
| 2 | Config and client | Complete (all five carried-forward items resolved) |
| 3 | Custodial accounts, both roles | Complete |
| 4 | Allocation | Complete |
| 5 | Purchase settlement | Complete |
| 6 | Merchant surface | Complete |
| - | Acceptance verification | Complete (12/12 passed on live testnet) |
| 7 | Teardown | Complete |
| 8 | Soroban | Roadmap, not MVP |

## Remaining work and gates

Updated 2026-08-05. Phases 0 through 7 are implemented. The remaining gates are:

1. **Run acceptance verification.** **[COMPLETED 2026-08-05]** The script (`scripts/acceptance-verification.ts`, runnable
   via `pnpm accept:stellar`) exercises bootstrap, registration, allocation, merchant approval,
   checkout, reconciliation, balance viewing, revocation, and sponsor-balance paths against real
   testnet state. It has been run against a live environment and achieved a perfect 12/12 pass rate.
2. **Leave Phase 8 untouched.** Soroban simulation, resource-fee computation, and contract
   authorization remain roadmap work and are not prerequisites for the classic-asset MVP.

## Ground rules

These hold in every phase. A change that violates one of them is wrong even if it compiles and
the tests pass.

1. **Postgres stays the source of truth for UX.** The `settle_sale` RPC is not modified in any
   phase. The merchant keeps getting an instant result at the counter, and the chain leg stays
   off the request path.
2. **Errors stay values.** The chain layer keeps returning `AppResult<T>` and keeps using
   `OnchainError` from `apps/server/src/lib/errors.ts`. Do not introduce throwing code paths, and
   do not add a new error tag. `OnchainError` already maps to HTTP 502.
3. **Migrations are append-only.** The highest existing migration is
   `supabase/migrations/00010_market_prices.sql`, so new files start at `00011`. Never edit an
   applied migration. Mirror every schema change in `packages/db/src/types.ts` in the same
   change, and update `packages/db/src/types.test.ts`.
4. **Secrets never widen their blast radius.** Stellar secret seeds are handled exactly like the
   existing EVM keys: loaded through config, never logged, never returned in a response, never
   written to a tracked file. Extend `collectConfiguredSecrets` in
   `apps/server/src/lib/redact.ts` when a new secret variable is added.
5. **The web app stays a view layer.** No chain writes move into `apps/web`. Phase 7 deletes the
   ones that are there today.
6. **Amounts are integers.** PHPC has 7 decimals on Stellar. Convert to and from integer stroops
   with `BigInt`, never floating point. See the conversion appendix.
7. **Forward compatibility is not optional.** The F1 through F8 items from ADR 004 are folded
   into the phases below as ordinary steps. They are cheap now and expensive later.
8. **Zod schemas are part of the boundary.** `packages/schema` validates every request and
   response, so an address or balance shape cannot change in the server alone. Three EVM
   validators live in `packages/schema/src/merchant.ts`: `CreateMerchantDto.walletAddress`
   (line 27), `MerchantDto.walletAddress` and `walletBalance` (lines 41-42), and
   `UpdateMerchantDto.walletAddress` (line 56). All three are `/^0x[a-fA-F0-9]{40}$/` today and
   will reject every Stellar address until changed, together with `merchant.test.ts`.
9. **A new CHECK constraint must survive the existing rows.** Postgres validates a new CHECK
   against current data, so adding a Stellar address pattern to a column holding `0x` values
   fails the migration outright. Resolve the cutover decision below before writing migration
   `00011`.
10. **Checkout and outbox enqueue must share one database transaction.** The live route must not
    call `settle_sale`, make a second unrelated database request, and claim the sale is protected
    by a transactional outbox. Keep the existing `settle_sale` function unchanged if required,
    but add an atomic wrapper or equivalent Postgres boundary in migration `00012` and make the
    route call that single boundary. The wrapper must preserve idempotency and semantic payloads.

## Data cutover decision

**Decide this before Phase 3.** It was not in ADR 004 and it blocks the Phase 3 migration.

Two pieces of live state do not survive the chain swap:

1. **Addresses.** `beneficiary_wallets.address` currently holds EVM addresses under the CHECK
   `^0x[0-9a-fA-F]{40}$` (`00003_polygon_amoy_migration.sql`, line 22). `merchants.wallet_address`
   holds EVM addresses with **no** CHECK at all: `00001_init_core_tables.sql` line 56 declares it
   plain `TEXT NOT NULL` and `00004_custodial_wallet.sql` only dropped the NOT NULL. Neither
   column's contents match a Stellar pattern.
2. **Balances.** Existing beneficiaries have a `credit_balance` in Postgres and PHPC on Polygon.
   Their new Stellar accounts start empty. Because Phase 5 settlement is a real
   beneficiary-to-merchant payment, every purchase by a pre-migration beneficiary fails on
   insufficient balance even though Postgres says the credit exists.

Pick one:

**Option A, reset (recommended for the demo).** Truncate `beneficiary_wallets`, `allocations`,
and `transactions`, null out `merchants.wallet_address`, and re-register the demo cohort after
Phase 3. Cheapest and safest, appropriate because this is a zero-value testnet MVP whose data is
demo data. The Phase 3 migration then adds its CHECK constraints against empty or nulled columns
and cannot fail.

**Option B, backfill.** Keep the rows, provision Stellar accounts for each, then pay each
beneficiary account its current `credit_balance` from distribution and each merchant its
`wallet_balance`. This requires a one-off reconciliation script, an audit record of what was
paid, and a `NOT VALID` CHECK constraint followed by a cleanup pass, because the old `0x` values
must be cleared before the constraint can be validated.

Whichever is chosen, record it in the Phase 3 pull request. Option A is assumed by the migration
steps below; if Option B is chosen, the constraint statements change and a backfill step is added
between Phase 4 and Phase 5.

## Phase 0: Prep and baseline

**Status: complete.** Recorded here so the sequence is readable end to end.

**Goal.** Establish a green baseline so migration breakage is distinguishable from pre-existing
breakage, and land the Stellar dependency and environment surface.

**What was done.**

- `pnpm install`, then `pnpm lint`, `pnpm type-check`, and `pnpm test` all green as the baseline.
- Added `@stellar/stellar-sdk@16.2.0` as an exact root dependency.
- Documented the new Stellar variables in `.env.example`, `apps/server/.env.example`,
  `apps/web/.env.example`, and `packages/contracts/.env.example`.

**Note on variable removal.** Phase 0 only *adds* the Stellar variables. The EVM variables stay
in place until Phase 7, because Phases 2 through 6 delete their consumers incrementally and the
app must keep booting throughout. Removing them earlier breaks `loadChainConfig` before its
replacement exists.

## Phase 1: Asset bootstrap

**Status: complete.** Recorded here for the same reason.

**Goal.** PHPC exists on Stellar testnet with the correct issuer flags, and provisioning is
repeatable after a testnet reset.

**What was done.**

- Added `scripts/bootstrap-stellar.ts` and the root `pnpm bootstrap:stellar` command.
- Created issuer, distribution, and sponsor accounts, funded by Friendbot.
- Set `AUTH_REQUIRED`, `AUTH_REVOCABLE`, and `AUTH_CLAWBACK_ENABLED` on the issuer.
- Created and authorized the distribution trustline, issued `100000 PHPC`.
- Recorded public addresses, transaction hashes, and the explorer link in
  `docs/stellar-testnet.md`. Secret seeds live only in the ignored local credential file.
- Verified idempotency by rerunning: the second run skipped every existing account, flag,
  trustline, authorization, and the supply target without submitting duplicate transactions.

**Standing obligation.** Because Stellar testnet resets wipe accounts, assets, and trustlines
(risk R2), `pnpm bootstrap:stellar` must stay idempotent as later phases touch it. Phase 3 adds
a companion re-provisioning path for beneficiary and merchant rows that already exist in
Postgres.

## Phase 2: Config and client

**Status: complete.** Recorded here for the same reason. The full gate was green at completion:
`pnpm lint`, `pnpm type-check`, and `pnpm test` (21 files, 192 tests) all pass.

**Goal.** Replace the EVM config loader and `BlockchainClient` with Stellar equivalents, keeping
the `AppResult` and `OnchainError` contract byte-for-byte identical so the blast radius stays
inside the chain layer.

**What was done.**

- Rewrote `apps/server/src/lib/chain/config.ts` for the Stellar variable set:
  `STELLAR_HORIZON_URL`, `STELLAR_NETWORK_PASSPHRASE`, `PHPC_ASSET_CODE`,
  `PHPC_ISSUER_PUBLIC_KEY`, `PHPC_ISSUER_SECRET`, `PHPC_DISTRIBUTION_SECRET`, and
  `STELLAR_SPONSOR_SECRET`. `CUSTODIAL_KEY_ENCRYPTION_KEY`, `QR_TOKEN_SECRET`, and
  `QR_TOKEN_TTL_SECONDS` carried over unchanged.
- Preserved both behaviours the old loader got right: every offending variable is reported in a
  single `ValidationError`, and no partial config is ever returned.
- Replaced the validators. `isHorizonUrl` rejects non-http/https, `localhost`, `127.0.0.1`, and
  the mainnet host `horizon.stellar.org`. `isStellarPublicKey` is `^G[A-Z2-7]{55}$` and
  `isStellarSecretSeed` is `^S[A-Z2-7]{55}$`. `PHPC_ISSUER_PUBLIC_KEY` is cross-checked by
  deriving it from `PHPC_ISSUER_SECRET`, and a mismatch is reported against the public key
  variable.
- Asserted `STELLAR_NETWORK_PASSPHRASE` equals `Networks.TESTNET` exactly.
- Wrote `StellarClient` with intent-named methods (F2): `allocateSubsidy`, `settlePurchase`,
  `getAssetBalance`, `hasAuthorizedTrustline`, and `getLedgerSequence`. No primary
  `payPHPC`-style method exists, but the compatibility shims remain until their callers move.
- `allocateSubsidy` takes a beneficiary account plus `tier` and derives the amount inside the
  chain layer from a `TIER_AMOUNTS` map (F4). `settlePurchase` currently accepts account IDs and a
  raw `beneficiarySecret`, builds a beneficiary-to-merchant payment, and wraps it in a
  sponsor-signed fee-bump transaction. The secret-bearing boundary and ADR F2 category input are
  still unfinished and are carried into Phase 5.
- Every write returns `{ hash, ledger }`, so the ledger sequence travels with the hash (F7).
- Amount conversion is exact integer `bigint` stroops in both directions (`balanceToStroops`,
  `stroopsToDecimal`). No `Number` appears in any money path.
- Deleted the EVM-only surface: `getPublicClientRef`, `getSubsidyContractAddress`,
  `hashBeneficiaryId`, the `keccak256` UUID hashing, `TxRequest`, `signAndSend`, the manual nonce
  arithmetic, the hardcoded gas limits, and the `console.log` calls that bypassed pino redaction.
- Extended `collectConfiguredSecrets` in `apps/server/src/lib/redact.ts` to cover
  `issuerSecret`, `distributionSecret`, and `sponsorSecret` alongside the retained
  `keyEncryptionKey` and `qrTokenSecret`.
- Ported `config.test.ts` and rewrote `chain.client.test.ts` against the new method surface,
  including the transport-failure case that asserts `OnchainError` is returned rather than thrown.
- `apps/server/src/routes/chain.ts` came along as a side effect. The Stellar balance read now
  reports stroops, while `POST /api/chain/transfer` returns 501 because the EVM arbitrary transfer
  from the deployer wallet has no in-scope Stellar equivalent. Phase 7 removes the POST and either
  retains this read as the admin distribution-balance endpoint or replaces it before changing the
  route registration, because both admin beneficiary and merchant pages currently call it.

**Carried forward deliberately.** Five items from the Phase 2 plan are not in the shipped state.
They are listed so they are not mistaken for oversights.

- **The legacy shims remain, by design.** `StellarClient` still exposes `transferPHPC`,
  `waitForConfirmation`, `getTreasuryBalance`, and `allocateCredits`, plus the `BlockchainClient`
  and `ChainClient` aliases. Their consumers are migrated in Phase 4
  (`beneficiary.service.ts`), Phase 5 (`cron/reconcile.ts`), and Phase 6 (`merchant-self.ts`),
  and each shim carries a `TODO(phase-N)` marker. Deleting them before their consumers existed
  would have broken the build mid-migration, which ground rule "every phase ends green" forbids.
- **`apps/server/src/types/env.ts` still has no Stellar bindings.** The EVM entries are present
  as planned, but the seven Stellar variables were never added to the `Env` interface. The gate
  stayed green because the chain layer reads env through `loadChainConfig` rather than through
  this type. Add them in whichever phase next touches the file.
- **F6 is only half satisfied.** There is no exported module-level fee constant, which is the
  letter of the checklist, but the fee is the SDK's `BASE_FEE` passed inline at each call site
  rather than a value the client computes. Phase 8 needs a computed fee to include Soroban
  resource fees, so this stays a real change rather than a rename.
- **`ChainWriteResult` is not a named type.** Every write returns the specified
  `{ hash: string; ledger: number }` shape, but inline rather than through the exported alias the
  plan named. Cosmetic. Worth fixing when Phase 4 or 5 next touches those signatures.
- **The final F2 boundary is not complete.** ADR 004's preferred boundary carries intent and
  category totals, while the current `settlePurchase` input carries account IDs and a raw
  beneficiary secret. Phase 5 must move key access behind `CustodialWalletService`, keep secrets
  out of outbox payloads and logs, and define the final typed input before the worker is wired.

**Not verified by the suite.** The Phase 2 exit criterion "constructs against testnet Horizon,
reads the distribution balance created in Phase 1" is not proven by `pnpm test`.
`chain.client.test.ts` mocks `@stellar/stellar-sdk` entirely so the tests never touch the
network, which is correct for unit tests but means a live Horizon read against the Phase 1
distribution account is still outstanding. Fold it into the acceptance verification, or run it
once by hand before relying on Phase 4.

## Phase 3: Custodial accounts, both roles

**Goal.** Generalize `CustodialWalletService` to provision Stellar accounts for both
beneficiaries and merchants, and give every PHPC holder an authorized trustline.

**Files.**

| Path | Action |
| --- | --- |
| `apps/server/src/services/custodial-wallet.service.ts` | Swap `viem/accounts` for Stellar `Keypair`. Generalize to both roles. |
| `apps/server/src/services/custodial-wallet.service.test.ts` | Extend for merchants and trustlines. |
| `supabase/migrations/00011_stellar_custodial_accounts.sql` | New. |
| `packages/db/src/types.ts` | Mirror the migration. |
| `apps/server/src/types/env.ts` | Add the Stellar bindings while retaining legacy EVM bindings until Phase 7. |
| `apps/server/src/repositories/merchant-wallet.repository.ts` | New repository for encrypted merchant seeds and public addresses. |
| `apps/server/src/services/beneficiary.service.ts` | Provision at live registration. |
| `apps/server/src/services/merchant.service.ts` | Provision at every live approval path. |
| `apps/server/src/routes/merchants.ts` | Ensure register, approve, and status transitions cannot mark an account ready without provisioning. |
| `scripts/provision-stellar-accounts.ts` | New reset/re-provisioning command for existing wallet rows. |
| `packages/schema/src/merchant.ts` | Replace the three EVM address validators (ground rule 8). |
| `packages/schema/src/merchant.test.ts` | Update the address fixtures and the rejection cases. |

**Steps.**

1. Replace key generation and the signing boundary. The parts of
   `CustodialWalletService` that carry over **unchanged** are AES-256-GCM storage, SHA-256 key
   derivation, the `EncryptedKey` shape, buffer zeroization, and the
   `MAX_GENERATION_ATTEMPTS` collision-retry loop. Replace `generatePrivateKey` and
   `privateKeyToAccount` with `Keypair.random()` and store the ed25519 seed. Replace the current
   viem `Account` callback with a Stellar-safe `withBeneficiaryKey` or equivalent callback that
   keeps the decrypted key inside the custody boundary for the shortest possible time. Do not
   return a raw seed to a route, put it in an outbox row, or log it. The same abstraction must work
   for merchant signing in Phase 5.
2. Apply the data cutover decision first. Freeze registration, allocation, checkout, and
   merchant address updates; take the required backup or export; record the selected option and
   row counts; then perform the reset or backfill in the same operational window as the migration.
   Under Option A the rows are cleared before the constraints are added, which is what makes the
   statements below safe.
3. Write migration `00011`:
   - Change the `beneficiary_wallets.address` CHECK constraint from `^0x[0-9a-fA-F]{40}$` (set
     in `00003_polygon_amoy_migration.sql`, line 22) to `^[GC][A-Z2-7]{55}$`. Use the `[GC]`
     character class, not `^G`, so Soroban contract addresses are accepted without a future
     migration (F5). Because migrations are append-only, drop and re-add the constraint rather
     than editing `00003`.
   - Add a `merchant_wallets` table mirroring `beneficiary_wallets`: `merchant_id` as primary
     key and foreign key, unique `address` with the same `^[GC][A-Z2-7]{55}$` CHECK, and
     `enc_ciphertext`, `enc_iv`, `enc_auth_tag`.
   - Add the same address CHECK to `merchants.wallet_address`. This column has **no** CHECK
     today, so the statement is an addition rather than a swap, and it will fail against any
     surviving `0x` value. The column is nullable as of `00004`, so `NULL` rows pass.
   - Add RLS policies matching the existing pattern: `admin_all_<table>` via `has_role('admin')`,
     and no merchant-readable policy on the encrypted key columns.
4. Replace the Zod validators in `packages/schema/src/merchant.ts` in the same change. Note that
   `CreateMerchantDto.walletAddress` and `UpdateMerchantDto.walletAddress` should be **removed**
   rather than repatterned: after this phase the system generates the address and no client
   supplies one. Keep `MerchantDto.walletAddress` as a read-only output field.
5. Implement provisioning as one ordered, resumable sequence per account:
   1. `createAccount` with a sponsored reserve from the sponsor account.
   2. `changeTrust` to create the PHPC trustline.
   3. `allowTrust` from the issuer to authorize it.

   Each step must be individually idempotent, checked against Horizon before submitting, exactly
   as `scripts/bootstrap-stellar.ts` already does. A partially provisioned account is the normal
   case after a failure, not an exception.
6. Set the trustline limit deliberately. The bootstrap script uses `1000000000` for the
   distribution account, which is correct for a treasury but wrong as a per-holder default. Use a
   limit that comfortably exceeds the largest possible single grant (Tier 1 is 5,000 PHPC) without
   being unbounded. Define it as one named constant shared by both roles.
7. Define the public-address source of truth. `merchant_wallets.address` stores the address next
   to the encrypted seed, while the existing `merchants.wallet_address` is already exposed by
   merchant DTOs and used by current readers. Either make one canonical and derive the other, or
   write both in one provisioning operation and add an equality check. The worker and profile route
   must not choose different sources silently.
8. Wire every live call site. Beneficiary provisioning happens at registration in
   `beneficiary.service.ts`. Merchant provisioning happens before an approval path returns
   `APPROVED` in `merchant.service.ts` and `routes/merchants.ts`, not at registration, so
   `PENDING` and `REJECTED` merchants never consume a reserve. The current service defaults some
   registrations to `APPROVED`, so that path must be covered too or the status must remain pending
   until provisioning succeeds.
9. Add a re-provisioning path for risk R2. After a testnet reset every stored address is dead.
   Implement the planned `scripts/provision-stellar-accounts.ts` command to walk existing
   `beneficiary_wallets` and `merchant_wallets` rows and re-create the account, trustline, and
   authorization for each. Reuse the stored keypair where the seed still decrypts; only generate a
   new one if it does not. Report partial failures without advancing the row as complete.
10. Add the trustline pre-check that risk R1 calls for. `hasAuthorizedTrustline(accountId)` already
    exists on `StellarClient` as of Phase 2, so wire it into allocation and settlement paths and
    give it a distinct, actionable error message. On Stellar a payment to an account without an
    authorized trustline fails outright, which has no EVM equivalent and is the easiest thing in
    this migration to miss.
11. Add the seven Stellar variables to `apps/server/src/types/env.ts` and keep the legacy EVM
    bindings only until Phase 7. The chain loader currently reads `process.env` directly, which is
    why the missing type bindings did not break the Phase 2 gate.

**Tests.**

- Encryption round-trip still passes with a Stellar seed as the payload.
- Address collision retry still works.
- Provisioning is idempotent: running it twice against an already-provisioned account submits
  nothing and returns success.
- Provisioning resumes correctly from each partial state: account exists but no trustline;
  trustline exists but unauthorized.
- `packages/db/src/types.test.ts` covers the new table and the changed constraint.
- Registration and approval tests prove that no merchant can become `APPROVED` without a
  provisioned account, and that the public address mirror cannot drift from the custody row.
- The `Env` type and the re-provisioning command are covered by the type-check and command-level
  tests.

**Exit criteria.** A newly registered beneficiary and a newly approved merchant both end up with
a funded Stellar account holding an authorized PHPC trustline, verifiable on Horizon. Full gate
green.

**Rollback.** Migration `00011` is additive plus one constraint swap. Write the down statements
in the review description even though they are not applied automatically.

## Phase 4: Allocation

**Goal.** Pay PHPC from the distribution account to the beneficiary account, replacing the
two-transaction transfer-then-allocate contract sequence.

**Files.**

| Path | Action |
| --- | --- |
| `apps/server/src/services/beneficiary.service.ts` | Rework `allocateTierCredits`; resolve the beneficiary wallet address and remove the old amount path. |
| `apps/server/src/services/chain.client.ts` | Introduce the named `ChainWriteResult`, finalize the tier-based allocation input, and remove allocation shims. |
| `apps/server/src/services/beneficiary.service.test.ts` | Update the allocation suites. |
| `apps/server/src/routes/beneficiaries.ts` | Caller at line 99; the route contract does not change. |
| `apps/server/src/e2e/transaction-flow.test.ts` | Update the `allocateCredits` mock at line 44 and the EVM `vi.stubEnv` calls at lines 216-218. |

**Steps.**

1. Replace the body of `allocateTierCredits` with one tier-based Stellar call. The service must
   resolve the beneficiary's provisioned Stellar account, pre-check its trustline, and pass a
   typed input containing the destination account and `tier`, not a pre-resolved amount. The chain
   layer cannot derive a Stellar account from a Supabase UUID by itself, so do not document or
   implement a fictitious two-argument call that omits the destination. Deleted by this change:
   the two-transaction sequence, the manual nonce arithmetic, the hardcoded gas limits, and the
   `console.log` calls.
2. Keep the invariants intact. Tier 1 is 5,000 PHPC and Tier 2 is 3,500 PHPC. The tier is
   computed server-side by the existing pure `computeTier` domain function, never supplied by a
   request body. The `allocations.beneficiary_id UNIQUE` constraint remains the one-time
   idempotency guard, and the `amount_phpc CHECK IN (5000, 3500)` constraint stays.
3. Move the tier-to-amount mapping into the chain layer (F4). Today the service computes
   `tier === 1 ? 5000 : 3500` and passes an amount. After this phase it passes the tier.
4. Pre-check the beneficiary's trustline before submitting and return a clear error if it is
   missing or unauthorized (R1).
5. Persist both the transaction hash and the ledger sequence on the `allocations` row (F7). Add
   the ledger column in migration `00012` alongside the Phase 5 columns if it is not already
   present.
6. Keep the existing confirmation timeout behaviour, but source it from the client rather than
   from a second hardcoded constant. The current code has a 60s allocation timeout sitting next
   to a 30s client default, which is confusing; pick one and document it.

**Tests.**

- Happy path for both tiers, asserting the amount is derived from the tier inside the chain
  layer and not passed in.
- A second allocation for the same beneficiary is rejected by the UNIQUE guard.
- Missing trustline returns an actionable error and submits nothing.
- Horizon failure returns `OnchainError` and leaves no partial database state.
- The named `ChainWriteResult` carries both hash and ledger, and no allocation-related legacy shim
  remains.

**Exit criteria.** Allocating to a real testnet beneficiary account moves PHPC from distribution
and the balance is visible on Horizon. Full gate green.

**Rollback.** Revert the branch. Allocations already written on-chain cannot be reverted, which
is expected on testnet; the UNIQUE guard prevents double allocation on retry.

## Phase 5: Purchase settlement

**Goal.** Make purchases actually reach the chain as beneficiary-to-merchant payments. This
phase fixes problem 1 from the ADR context: today the live checkout route inserts no outbox row,
so the reconcile worker always finds zero rows.

**Files.**

| Path | Action |
| --- | --- |
| `apps/server/src/routes/transactions.ts` | Replace the direct RPC-plus-fabricated-row path with the atomic settlement boundary and add the `revoked` check. |
| `apps/server/src/services/custodial-wallet.service.ts` | Expose the secret-safe callback needed by the settlement worker; never pass a raw seed through the outbox. |
| `apps/server/src/services/transaction.service.ts` | Refactor or retire the old `createTransaction` helper so it cannot create a transaction without the atomic settlement boundary; preserve `restoreBeneficiaryBalance` behind a guarded compensator. |
| `apps/server/src/cron/reconcile.ts` | Rewrite the pending-event submission step and remove the `transferPHPC` shim. |
| `apps/server/src/routes/balance.ts` | Add the `revoked` check. |
| `supabase/migrations/00012_stellar_settlement.sql` | New. |
| `apps/server/src/services/transaction.machine.ts` | Update the XState lifecycle labels. It is descriptive, not load-bearing, but leaving it describing an EVM broadcast is misleading. |
| `apps/server/src/e2e/transaction-flow.test.ts` | Extend; this is the closest thing to an integration test in the repo. |

**Steps.**

1. Replace the current live route sequence. Today it calls `settle_sale`, fabricates a `txRow`,
   and returns without an outbox row; `TransactionService.createTransaction` is not a drop-in
   replacement because it inserts a transaction without calling `settle_sale`. Add an atomic
   Postgres boundary in `00012`, preferably a `settle_sale_and_enqueue` wrapper that calls the
   unchanged `settle_sale`, applies the required transaction metadata, sets the chain lifecycle
   to `PENDING_CHAIN`, and inserts exactly one outbox row before returning. The wrapper must check
   the idempotency key inside the same transaction. The route then maps the persisted row instead of
   fabricating a second representation.
2. Keep the outbox payload semantic (F3). It must describe what happened, never a pre-built
   serialized XDR operation, because every queued row would break on a future cutover. Required
   fields: `transactionId`, `beneficiaryId`, `merchantId`, `amountStroops`, and per-category
   totals. Add the category totals now even though the classic path ignores them, so the inputs
   a future contract needs are already being captured.
3. Rewrite the reconcile worker to build a payment from the beneficiary account to the merchant
   account, signed through the custody service's short-lived key callback, wrapped in a fee-bump
   transaction paid by the sponsor account. The semantic outbox row contains identifiers and
   amounts, not a secret. Resolve the merchant public address from the Phase 3 source of truth,
   and remove the stale `Submitting transaction to Polygon Amoy testnet` log. Neither guardians
   nor merchants ever hold XLM.
4. Keep the worker serial. Concurrent submissions from one source account collide on sequence
   number (R3). The current worker already processes rows serially and claims up to 20 rows per
   run; preserve that. If it is ever parallelized, channel accounts are the fix, not retries.
5. Preserve the existing retry policy: up to 3 attempts, then outbox `FAILED` and transaction
   `FAILED`. Define the compensation precisely. A failed chain payment must not leave the
   beneficiary's Postgres balance permanently lower, so restore that balance through a guarded
   database operation and write the `BALANCE_RESTORATION_AUDIT` row. Because `settle_sale` also
   increments `merchants.wallet_balance`, document whether that column remains a cumulative audit
   total or is compensated as well; do not restore only one side and call the ledger reconciled.
6. Convert all amounts to integer stroops at 7 decimals (R4). Every `10n ** 18n` and the
   `BigInt(Math.round(amount * 100)) * BigInt(10 ** 16)` cash-out expression is reworked. Audit
   the aggregation before conversion too: the current route and `TransactionService` use
   `Number(item.creditCost)` and numeric balance arithmetic. Preserve the two-decimal Postgres
   value as a decimal string or integer centavos, then convert exactly to stroops. See the
   conversion appendix.
7. Write migration `00012`:
   - Add a stroops sibling column to `transactions` rather than renaming
     `stablecoin_amount_wei`, because migrations are append-only. Suggested name:
     `asset_amount_stroops` as `TEXT`, matching how the wei column is already stored.
   - Add a ledger sequence column to `transactions` and `allocations` for reconciliation (F7).
   - Add the atomic settlement-and-outbox wrapper described in step 1. It must be idempotent,
     populate the stroops and idempotency fields, and avoid a second insert site.
   - Do not add a new status value. `PENDING_CHAIN` absorbs a future pre-submission simulation
     step (F8). The wrapper must make the existing `settle_sale` row pending for the chain leg
     before enqueueing. `packages/db/src/types.ts` currently lists `DB_RECORDED` and `BROADCAST`,
     which the SQL CHECK rejects; do not start writing them. Mirror every new column and function
     in the DB types and tests.
8. While in the checkout route and the balance view, add the missing `qr_passes.revoked` check.
   Today only `POST /api/auth/verify-qr` checks it, so a revoked pass can still transact and can
   still be read. This is a real security gap and this phase is where it gets closed.
9. Decide what `merchants.wallet_balance` means now, and write it down. `settle_sale` keeps
   crediting the column, because ground rule 1 forbids changing the RPC, but after Phase 6 the
   merchant UI reads the on-chain balance instead. The column therefore becomes a cumulative
   record of settled sales rather than a withdrawable liability. Do not silently leave two
   competing balances with no stated relationship: document the column as an audit total in
   `.kiro/steering/data-model.md`, add a reconciliation check against the merchant's on-chain
   balance, and define how a permanently failed chain payment appears in that audit. The route
   response must also come from the persisted RPC row, not a hand-built row with `0` wei.

**Tests.**

- Checkout inserts exactly one outbox row with a semantic payload including category totals.
- The worker submits a fee-bumped beneficiary-to-merchant payment and marks the row `DONE` and
  the transaction `CONFIRMED`.
- Three failed attempts mark the row `FAILED` and write the audit row.
- A revoked pass is rejected at checkout and at the balance view.
- Stroops conversion is exact for values with two decimal places. Add a `fast-check` property
  test asserting the round trip never loses precision, matching the existing property-test style.

**Exit criteria.** A purchase made through the merchant surface produces a confirmed
beneficiary-to-merchant payment on Horizon, and the beneficiary's on-chain balance decreases.
The one-way-ledger bug is gone because Stellar debits the sender natively. Full gate green.

**Rollback.** Revert the branch. Queued outbox rows remain valid because the payload is semantic
rather than a serialized operation, which is exactly why F3 matters.

## Phase 6: Merchant surface

**Goal.** Merchants hold real PHPC, so the custodial cash-out liability disappears and the
wallet-connect flow becomes dead weight.

**Files.**

| Path | Action |
| --- | --- |
| `apps/server/src/routes/merchant-self.ts` | Delete `POST /api/merchants/me/wallet` and `POST /api/merchants/me/cashout`; repoint `GET /api/merchants/me`. |
| `apps/server/src/routes/merchant-self.test.ts` | Rewrite. |
| `apps/server/src/routes/auth.ts` | Delete `POST /api/auth/wallet-login`. |
| `apps/server/src/services/wallet-adapter.gateway.ts` | Delete, along with its test. |
| `apps/server/src/dto/mappers.ts` | Update the merchant DTO and refresh the snapshot deliberately. |
| `packages/schema/src/merchant.ts` | Confirm `MerchantDto.walletBalance` models an on-chain read and choose an exact 7-decimal-safe representation. |
| `apps/web/components/merchant/wallet-balance-card.tsx` | Remove wallet-connect and transfer actions; render the generated custodial account as read-only. |
| `apps/web/components/merchant/transfer-modal.tsx` | Delete or replace the cash-out mutation UI and all MetaMask/Polygon copy. |
| `apps/web/hooks/use-merchant-profile.ts` | Update the profile type if the balance/address representation changes. |
| `apps/web/app/(merchant)/dashboard/page.tsx` | Keep the dashboard on the read-only profile contract. |
| `apps/web/lib/services/merchant.service.ts` | Remove dead EVM registration and wallet-write code. |
| `.kiro/steering/api-surface.md` | Update the documented route table. |

**Steps.**

1. Delete `POST /api/merchants/me/wallet`. Merchants no longer supply an address; the system
   generates one in Phase 3.
2. Delete `POST /api/auth/wallet-login` and `wallet-adapter.gateway.ts`. Per ADR decision D4
   there is no proof-of-ownership flow and no Freighter dependency. Merchants continue to log in
   with mobile number and password, which is untouched.
3. Repoint `GET /api/merchants/me` so the public merchant address comes from the Phase 3
   custody record and `walletBalance` is the live on-chain PHPC balance read from Horizon rather
   than the custodial `merchants.wallet_balance` column. Decide the representation before coding:
   the current DTO uses a JavaScript number and `toTwoDecimalPlaces`, while Stellar balances have
   7 decimals. Prefer a canonical decimal string or an explicit stroops field; never silently
   round a Horizon value to zero or two decimals. Handle Horizon failure as a typed error, never a
   silent zero.
4. Delete `POST /api/merchants/me/cashout` and remove the transfer action from the screen. The
   remaining dashboard is read-only per decision D3. Stop writing `cashout_in_progress`; there is
   no custodial sweep left to serialize. Leave the column in place, since migrations are append-only.
5. Update the merchant DTO mapper and regenerate
   `apps/server/src/dto/__snapshots__/mappers.test.ts.snap` deliberately. That snapshot encodes
   the public API shape, so review the diff rather than accepting it blindly.
6. Update every merchant-facing web caller to match the narrowed API. Remove the
   `pickWallet`/`/api/merchants/me/wallet` flow from `wallet-balance-card.tsx`, remove the
   `/api/merchants/me/cashout` mutation and MetaMask language from `transfer-modal.tsx`, and keep
   the dashboard on the read-only `GET /api/merchants/me` response. The web app must not create
   chain clients or read Horizon directly.

**Tests.**

- `GET /api/merchants/me` returns the Horizon balance and still 403s for a `SUSPENDED` merchant.
- The deleted routes return 404.
- Horizon read failure produces a typed error, not a zero balance.
- The DTO snapshot diff is intentional and reviewed.
- A repository-wide search proves there are no frontend callers for wallet-connect, wallet-login,
  or cash-out before their server routes are deleted.

**Exit criteria.** The merchant dashboard shows a live on-chain balance, no endpoint accepts a
merchant-supplied address, and no code writes `cashout_in_progress`. Full gate green.

**Rollback.** Revert the branch. No schema change is required by this phase.

## Phase 7: Teardown

**Goal.** Remove the EVM stack entirely and make regression structurally impossible.

**Files and deletions.**

| Path | Action |
| --- | --- |
| `packages/contracts/` | Delete the whole package, including `contracts/`, `scripts/deploy.ts`, `scripts/mint-additional.ts`, `hardhat.config.ts`, and the Hardhat tests. |
| `apps/web/lib/chain/contracts.ts` | Delete. |
| `apps/web/lib/chain/wallet-adapter.ts` | Delete. |
| `apps/web/lib/services/beneficiary.service.ts` | Delete the dead on-chain `allocateCredits` write and its EVM imports. |
| `apps/web/lib/services/merchant.service.ts` | Delete the dead chain-write code. |
| `apps/server/src/services/event-listener.ts` | Delete. It is already a deliberate no-op superseded by the reconcile cron. |
| `apps/server/src/index.ts` | Remove the `startChainEventListener` dynamic import and call before deleting the no-op service. |
| `apps/server/src/routes/chain.ts` | Remove the 501 `POST /api/chain/transfer`; retain or replace the Stellar `GET /api/chain/balance` read used by both admin pages. |
| `apps/server/src/app.ts` | Keep the route registration only if the Stellar balance read remains; remove any legacy transfer registration. |
| `apps/web/app/admin/beneficiaries/page.tsx` | Keep or migrate the live distribution-balance caller before any server route removal. |
| `apps/web/app/admin/merchants/page.tsx` | Keep or migrate the live distribution-balance caller before any server route removal. |
| `apps/web/lib/env.ts` | Remove the EVM fallbacks, including the Hardhat account #0 default for `DEPLOYER_PRIVATE_KEY`. |
| `apps/server/src/types/env.ts` | Remove the legacy EVM bindings after all server consumers are gone. |
| `turbo.json` | Remove EVM globals and add every retained Stellar public/server variable needed for cache correctness. |
| `apps/server/src/static-checks/forbidden-references.test.ts` | Repoint at EVM terms and remove the broad web-code allowlist. |

**Steps.**

1. Delete `packages/contracts` and remove it from the workspace. Drop `viem`, `hardhat`,
   `@nomicfoundation/hardhat-toolbox-viem`, and the OpenZeppelin packages from every
   `package.json`. Remove the `deploy:contracts` script from the root `package.json`.
2. Delete `apps/web/lib/chain/*` and the dead chain-write code in the two web services only
   after the Phase 6 frontend cleanup proves there are no callers. Do not delete the server's
   Stellar balance read merely because its file is named `chain.ts`; migrate the two admin pages
   or retain the read endpoint until both callers are safe.
3. Repoint the static check. It currently excludes `.kiro`, `apps/web`, and a legacy contract
   path, so it cannot prove a repo-wide EVM teardown. After the Phase 6 callers are removed,
   remove the broad `/apps/web/` and legacy-contract allowlist entries, retain only narrowly
   justified historical exclusions, and add patterns for `viem`, `Polygon`, `Amoy`, `80002`,
   EVM private-key/address literals, `PHPCSubsidy`, `ERC-20`, `Hardhat`, `MetaMask`, and
   `personal_sign`. Keep the file-count assertion. Prove the check fails with one temporary
   reintroduced term, then remove it and rerun the full gate.
4. Remove the EVM variables now that every consumer is gone: `POLYGON_AMOY_RPC_URL`,
   `DEPLOYER_PRIVATE_KEY`, `LGU_ADMIN_WALLET_ADDRESS`, `PHPC_TOKEN_ADDRESS`,
   `PHPC_SUBSIDY_ADDRESS`, `BENEFICIARY_REGISTRY_ADDRESS`, and `MERCHANT_REGISTRY_ADDRESS`,
   including their `NEXT_PUBLIC_` forms. Remove them from `apps/server/src/types/env.ts`,
   `apps/web/lib/env.ts`, all tracked `.env.example` files, and `turbo.json` `globalEnv`; keep
   the Stellar variables and any retained public variables in the cache list. The
   `packages/contracts/.env.example` file goes with the deleted package.
5. Reconcile `packages/db/src/types.ts` with the SQL. This is a good moment to fix the
   pre-existing drift documented in `.kiro/steering/data-model.md`: the missing
   `intervention_tier`, `total_amount`, and `outbox.last_error` fields, the invalid
   `DB_RECORDED` and `BROADCAST` statuses, the `outbox.run_after` column that no migration
   creates, and the `photo_receipts` table and `claim_outbox_rows` function that are typed but
   may not exist.
6. Update the documentation set: `README.md` (the tech stack table and the contracts commands),
   the root `package.json` description which still says "mock PHPC on Ronin Saigon testnet",
   `docs/CODEBASE_OVERVIEW.md`, `docs/SECURITY.md`, and `docs/adr/001-transactional-outbox.md`.
   Mark `docs/SMART_CONTRACT_OPS.md` superseded or replace it with a Stellar operations
   equivalent. Update the steering files that describe the chain layer:
   `.kiro/steering/blockchain.md`, `tech.md`, `product.md`, `security.md`, `api-surface.md`,
   `data-model.md`, and `structure.md`.
7. While updating `docs/SECURITY.md`, resolve the two documented drifts rather than carrying them
   forward: the claim that scanned images are never stored (the `analyzeScan` path persists a
   base64 data URL in `products.image_url`), and the description of on-chain `processTransaction`
   enforcement, which no longer exists in any form.

**Tests.**

- The static check fails when an EVM term is reintroduced outside the allowlist. Prove this by
  adding one temporarily and confirming the failure, then removing it.
- `pnpm build`, `pnpm lint`, `pnpm type-check`, and `pnpm test` are green with the contracts
  package gone.
- No workspace still resolves `viem`, `hardhat`, OpenZeppelin, or the old contract package.
- The retained admin distribution-balance read still works if the route is kept, and no deleted
  wallet or cash-out endpoint has a frontend or server caller.

**Exit criteria.** No EVM code, dependency, environment variable, or documentation claim remains,
and the static check blocks reintroduction. Full gate green.

**Rollback.** This is the least reversible phase because it is mostly deletion. Do it last, on
its own branch, after Phases 2 through 6 are merged and demonstrated working.

## Phase 8: Soroban

Roadmap only. Do not start any part of this before Phase 7 is merged.

Phase 8 is additive rather than a second migration, because a classic Stellar asset can be
wrapped as a Stellar Asset Contract. The PHPC issued in Phase 1 is the same PHPC a Soroban
contract would move. The asset is not reissued and holders do not need new trustlines.

**What is contract-shaped:** category spending caps, the RA 11148 tier eligibility window
evaluated against `ledger.timestamp()`, expiring unspent subsidies, spending velocity limits,
the one-time allocation guard as an on-chain invariant, and merchant settlement holdback.

**What must not move on-chain, in any phase:** multi-approver disbursement (Stellar classic
already does this with multisig thresholds on the distribution account), freeze and clawback
(already covered by the Phase 1 issuer flags), plain transfers (a classic payment is cheaper
than a contract invocation), the product catalog and vision results (too much mutable data; ADR
003's separation stands), and guardian PINs or any PII.

When Phase 8 begins, the work is confined to: authorizing the contract's `C...` address under
`AUTH_REQUIRED` (F1), swapping the bodies of the intent-shaped `StellarClient` methods (F2),
adding a simulation step before signing (F8), and switching the fee computation to include
resource fees (F6). No caller changes, no outbox payload changes, no schema changes.

## Acceptance verification

Run this after Phase 6, before starting Phase 7. Phases 2 through 6 each prove their own unit
behaviour, but nothing so far exercises the three surfaces together against real testnet state,
and Phase 7 is the least reversible phase. Do not start it on unverified work.

1. Bootstrap is clean from zero: `pnpm bootstrap:stellar` against freshly reset testnet accounts
   succeeds, and a second run is a no-op.
2. Admin registers a guardian and child. Confirm on Horizon that a funded Stellar account with an
   authorized PHPC trustline now exists.
3. Admin releases the grant. Confirm the tier-correct amount (5,000 or 3,500) arrives on the
   beneficiary account, and that a second release attempt is rejected.
4. Admin approves a merchant. Confirm the merchant account and authorized trustline exist.
5. Merchant scans a product, builds a basket, and checks out with the guardian PIN. Confirm the
   counter result is instant, and that the reconcile cron then produces a fee-bumped
   beneficiary-to-merchant payment on Horizon.
6. Confirm the beneficiary's on-chain balance **decreased**. This is the specific bug the
   migration exists to fix, so verify it explicitly rather than assuming it.
7. Guardian scans the pass. Confirm the balance view matches Postgres, and that a revoked pass is
   rejected at both the balance view and checkout.
8. Merchant dashboard shows the live on-chain balance.
9. Negative paths: a beneficiary with no trustline produces a clear error and no partial state; a
   Horizon outage produces `OnchainError` and HTTP 502, not a silent zero balance.
10. Confirm the sponsor account still holds enough XLM after all of the above, and record the
    burn rate per provisioned account (risk R7).

## Explicitly out of scope

Stating this so the absence is a decision rather than an oversight.

- **Freeze and clawback have no admin surface.** Phase 1 sets `AUTH_REVOCABLE` and
  `AUTH_CLAWBACK_ENABLED`, which is what makes LGU enforcement *possible*, but no phase here
  builds an endpoint or screen to use them. The capability exists at the protocol level and is
  operable manually with the issuer key. Building the admin surface is follow-up work, not part
  of this migration.
- **Multi-approver disbursement** is available natively through multisig thresholds on the
  distribution account and is not configured in any phase.
- **Mainnet.** No phase touches mainnet. `loadChainConfig` actively rejects a mainnet Horizon URL
  from Phase 2 onward.
- **Soroban.** Phase 8, roadmap only.

## Forward-compatibility checklist

Verify each of these is satisfied at the end of the phase that owns it. They are the reason
Phase 8 stays additive.

| Item | Requirement | Owning phase | Verify by |
| --- | --- | --- | --- |
| F1 | Do not treat "only `G...` addresses hold PHPC" as an invariant | 3 | Address CHECK accepts `[GC]` |
| F2 | `StellarClient` methods are intent-shaped and secret-safe | 2, 5 | Primary methods have intent names; final inputs contain no raw seed or serialized operation, and all shims are gone |
| F3 | Outbox payload is semantic, with category totals | 5 | Payload contains no serialized XDR |
| F4 | `tier` crosses the chain boundary, not an amount | 4 | Service passes tier; client derives amount |
| F5 | Address CHECK is `^[GC][A-Z2-7]{55}$` | 3 | Migration `00011` |
| F6 | Fee is computed, not a module constant | 2, 8 | Classic fee policy is isolated now; Soroban resource fees are computed after simulation |
| F7 | Ledger sequence stored with the hash | 2, 4, 5 | `ChainWriteResult` and the new columns |
| F8 | Lifecycle tolerates a pre-submission step | 5 | No new status added; `PENDING_CHAIN` reused |

**Phase 2 outcome.** F4 is implemented in the client, but the live allocation caller still uses
the legacy amount-based shim and must be migrated in Phase 4. F2 is partial: the primary method
names are intent-shaped, but the current secret-bearing and account-ID parameters do not yet match
the final ADR boundary. F7 is satisfied in substance, since every write returns `{ hash, ledger }`,
but the shape is inline rather than a named `ChainWriteResult`. F6 is half satisfied: no exported
fee constant exists, yet the fee is still the SDK's `BASE_FEE` passed inline rather than computed.
F1, F3, and F5 belong to later phases and are untouched.

## Risk register

| Risk | Description | Mitigated in | Mitigation |
| --- | --- | --- | --- |
| R1 | Trustlines are a new failure mode with no EVM equivalent. A payment to an account without an authorized trustline fails outright. | 3, 4, 5 | `hasAuthorizedTrustline` pre-check on every payment path, with a distinct actionable error, plus a trustline step in both onboarding flows. |
| R2 | Testnet resets wipe accounts, assets, and trustlines. | 1, 3 | Idempotent `pnpm bootstrap:stellar` plus a re-provisioning command for existing rows. Do not schedule a demo immediately after a reset. |
| R3 | Sequence numbers are stricter than nonces; concurrent submissions from one source account collide. | 5 | Keep the outbox worker serial. Channel accounts if it is ever parallelized. |
| R4 | Seven decimals, not eighteen. | 5 | Integer stroops everywhere, a stroops sibling column rather than a rename, and a property test on the round trip. |
| R5 | Custodial merchant keys widen the blast radius of a `CUSTODIAL_KEY_ENCRYPTION_KEY` compromise. | Accepted | Acceptable for a testnet MVP with zero-value assets. Revisit before any mainnet use. |
| R6 | Narrative change from "we wrote a smart contract" to "we used native asset primitives". | 7 | Phase 8 section makes the roadmap concrete. Update README and the demo script. |
| R7 | Sponsor account depletion. Every provisioned account consumes a base reserve plus fees from the sponsor, and every settlement consumes a fee-bump fee. An empty sponsor silently halts all provisioning and all settlement at once. Not in ADR 004. | 3, 5 | Check the sponsor balance before provisioning and before each reconcile batch. Log a warning below a threshold. Friendbot can refill on testnet. Record the burn rate during acceptance verification. |
| R8 | New CHECK constraints fail against existing `0x` rows, so migration `00011` will not apply to a populated database. Not in ADR 004. | 3 | Resolve the data cutover decision first. Option A clears the rows; Option B needs `NOT VALID` plus a cleanup pass. |
| R9 | Two balances with no stated relationship. `settle_sale` keeps crediting `merchants.wallet_balance` while the UI reads Horizon. | 5, 6 | Document the column as a cumulative audit total and add a drift check against the on-chain balance. |
| R10 | The current checkout can commit the Postgres sale and omit the outbox row, or return a fabricated DTO that differs from the stored row. | 5 | Use one idempotent Postgres settlement-and-enqueue boundary and map the persisted row. |
| R11 | `merchant_wallets.address` and `merchants.wallet_address` can diverge once both exist. | 3, 5, 6 | Choose one source of truth or write and compare both in one provisioning path. |

## Appendix A: Environment variables

**Added in Phase 0, consumed from Phase 2 onward.**

```
STELLAR_HORIZON_URL
STELLAR_NETWORK_PASSPHRASE
PHPC_ASSET_CODE
PHPC_ISSUER_PUBLIC_KEY
PHPC_ISSUER_SECRET
PHPC_DISTRIBUTION_SECRET
STELLAR_SPONSOR_SECRET
```

**Removed in Phase 7, not before.**

```
POLYGON_AMOY_RPC_URL
DEPLOYER_PRIVATE_KEY
LGU_ADMIN_WALLET_ADDRESS
PHPC_TOKEN_ADDRESS
PHPC_SUBSIDY_ADDRESS
BENEFICIARY_REGISTRY_ADDRESS
MERCHANT_REGISTRY_ADDRESS
```

**Retained unchanged throughout.** `CUSTODIAL_KEY_ENCRYPTION_KEY`, `QR_TOKEN_SECRET`,
`CRON_SECRET`, and every Supabase, Upstash, and Gemini variable.

Every variable added or removed must also be updated in `turbo.json` `globalEnv`, or the
Turborepo cache will be incorrect. Secret seeds live only in ignored local files; the tracked
`.env.example` files carry names and placeholder shapes only.

## Appendix B: Amount conversion

One credit is one PHP is one PHPC. Postgres stays `NUMERIC(12,2)`. Stellar uses 7 decimals, so
one PHPC is 10,000,000 stroops.

```ts
const STROOPS_PER_ASSET = 10_000_000n

// Postgres NUMERIC(12,2) string to stroops. Exact, no floating point.
function pesosToStroops(amount: string): bigint {
  const [whole, fraction = ''] = amount.split('.')
  const padded = fraction.padEnd(7, '0').slice(0, 7)
  return BigInt(whole) * STROOPS_PER_ASSET + BigInt(padded)
}
```

Do not use `Number` at any point in a money path. The expressions being replaced are
`BigInt(totalCreditDeducted) * 10n ** 18n` in `transaction.service.ts` and
`BigInt(Math.round(amount * 100)) * 10n ** 16n` in the cash-out path. The item aggregation and
compensating balance restoration must also preserve decimal text or integer centavos before the
final stroop conversion; changing only the final multiplication is not enough.

## Appendix C: Command reference

```bash
pnpm install
pnpm bootstrap:stellar                  # idempotent; safe after a testnet reset
pnpm bootstrap:stellar -- --provision-only

pnpm dev                                # web :3000, server :3001
pnpm lint
pnpm type-check
pnpm test

pnpm --filter @bantayog/server test
pnpm --filter @bantayog/web test
pnpm --filter @bantayog/db test
pnpm --filter @bantayog/schema test
```

Prefer `pnpm --filter <pkg> <script>` over changing directories. Apply new migrations to the
Supabase project in numeric order.
