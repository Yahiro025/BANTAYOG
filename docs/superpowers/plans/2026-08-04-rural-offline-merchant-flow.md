# Rural Offline Merchant Flow Implementation Plan

Last updated: 2026-08-05

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Urban and Rural merchant APK variants. Keep Urban no-card checkout online through beneficiary name search. Add quota-limited Rural offline product validation, beneficiary search, PIN validation, sale recording, synchronization, and server-controlled cash-out eligibility.

**Architecture:** The official Hono and Supabase Postgres backend remains the authority for beneficiaries, assignments, catalogs, credits, reservations, official transactions, conflicts, and merchant balances. Before a Rural device disconnects, the backend reserves bounded amounts only for approved beneficiary-merchant assignments. The Rural APK stores signed permits and local events, not beneficiary balances. Both APKs use a shared Branded barcode scanner. Rural permit-backed sales use one local-first event path, with immediate synchronization when online and a durable outbox when offline.

**Tech Stack:** pnpm 9.15.0, Node 20+, Turborepo, Hono 4, Supabase Postgres, Postgres RPCs, Zod 4, neverthrow, jose, ES256 P-256 JWS, viem, Next.js 16, Capacitor 8.4.2, Android Java and Kotlin, Android Keystore, Android SQLite/SQLCipher after approval, WorkManager, bundled ML Kit barcode and Latin OCR or the approved equivalent, OpenCV for image quality and crop operations, Gradle Groovy scripts, and Vitest.

## Global Constraints

- Read docs/adr/004-rural-offline-quota-authorization.md and docs/superpowers/specs/2026-08-04-offline-product-validation-and-transactions-design.md before changing code.
- Treat the current checkout as Urban online behavior until the Rural implementation passes the device gates.
- Urban no-card payment must use live backend beneficiary name search. A PIN is an authenticator, not an account identifier.
- Only an active administrator-approved beneficiary-merchant assignment can authorize Rural
  search, provisioning, PIN verifier creation, or reservation issuance. One beneficiary can have
  at most seven active distinct Rural merchant assignments.
- Rural local storage must never contain an authoritative beneficiary credit balance.
- The server must issue separate, signed permits for each beneficiary, merchant, and device. A
  permit has a maximum lifetime of 30 calendar days. The phone stops new offline sales 24 hours
  before expiry, and the server must receive an event before the signed expiry.
- The server must enforce the global reservation invariant while holding the beneficiary row lock:
  credit_balance - sum(active reservation remaining amounts) >= new reservation amount.
- The server must allow active permits for at most seven distinct Rural `merchant_id` values per
  beneficiary. Count merchants, not devices. An eighth distinct merchant is rejected, and multiple
  devices for one merchant share that merchant's allocation.
- While the beneficiary row is locked, the sum of active remaining reservations for one
  beneficiary and merchant, plus a new device reservation, must not exceed the server policy cap
  for that beneficiary and merchant.
- Online settlement must exclude active offline reservations from spendable credits.
- Rural local sales are PENDING_SYNC in the local store only. Do not add PENDING_SYNC to transactions.status.
- Event claim, official transaction insertion, beneficiary deduction, reservation consumption,
  merchant credit, final event decision, and synchronization receipt must happen in one Postgres
  transaction for an accepted event.
- Do not reimplement balance math or row-lock logic in TypeScript or the WebView.
- Do not send the canonical beneficiary pin_hash_argon2id to a device. Rural may use only a separate device-bound offline verifier package.
- Do not put a QR signing private key, HMAC minting secret, deployer key, PIN, or private key in an APK.
- Use asymmetric signatures for QR permits and device events. Remove deployed QR signing fallbacks before enabling offline verification.
- Use QR pass version 2 with ES256 P-256 and no HMAC fallback. Use separate key pairs for QR,
  permit, and catalog signatures. Every pass route checks expiry and revocation.
- Keep product eligibility catalog-backed. Barcode lookup comes first in both APKs for Branded
  products. Gemini remains the online fallback. Unknown products block sale. Unknown categories
  map to OTHER and do not become eligible.
- Rural permit-backed checkout must create one sale ID and one signed local event before the first
  upload attempt. Timeout, retry, late response, and offline fallback reuse that event.
- Fall back to the Rural deterministic validator only for network, DNS, timeout, 408, 429, or 5xx.
  Do not fall back after ineligible, invalid-image, authentication, or signature/configuration results.
- Require a signed offline merchant certificate and native merchant unlock for local Rural actions.
  A fresh online session remains required for sync, provisioning, release, administration, and cash-out.
- Use exact money. Signed payment payloads, TypeScript, Kotlin, and SQLite use whole integer
  credits. Postgres stores money as `NUMERIC(12,2)` and requires offline credit amounts to have
  `.00`. One credit is one PHPC and `10^18` PHPC wei. Item-price evidence uses integer centavos.
  Do not use floating-point money math.
- Use the permit-pinned catalog and policy versions for routine rule updates. A current emergency
  revocation creates a conflict and `Needs review`; it does not become cash-outable automatically.
- Permit expiry uses server receipt time. A device `createdAt` is audit data only and cannot extend
  the permit.
- Expiry or release only removes the reservation from the active sum. It must never increment
  `beneficiaries.credit_balance`.
- Permit warnings occur at seven days and 72 hours. The phone stops sales 24 hours before expiry,
  uses non-decreasing trusted time, detects rollback, and fails closed on a large forward jump.
- Offline no-card payment locks after five failed PIN attempts until online re-provisioning. Its
  signed policy must include per-sale, total-amount, and event-count limits. Missing limits fail
  closed. The controlled-pilot upper limits are 200 credits per sale, 500 credits in total per
  verifier, and three successful no-card events. A permit can lower these values. Raising a value
  needs a later ADR and security review.
- Treat offline PIN validation as a bounded local deterrent, not server proof of guardian consent.
- Catalog releases are administrator-created, immutable, validated, signed, installed atomically,
  and permit-pinned. An invalid install keeps the last-known-good release.
- Conflict review is append-only. The first-release action is terminal close-rejected. Any later
  remediation is a separate fully authorized online transaction; the original conflict stays unchanged.
- Purge expired or revoked directory records and PIN verifiers. Keep pending and Needs Review
  events until receipt or resolution. Never copy a device private key during replacement.
- Keep server code in route → service → repository layers. Expected failures return AppResult values.
- Every new server file must keep the ownership and requirements header style.
- Every schema migration is append-only. Verify the next migration number at execution time. Never edit an applied migration.
- Mirror every new table, function, and enum in packages/db/src/types.ts and packages/db/src/types.test.ts.
- Update packages/schema for every API contract. Update DTO snapshots deliberately when DTO shapes change.
- Ask the owner before applying a migration to a real Supabase project, changing settle_sale, changing authentication or RLS, adding native crypto/storage dependencies, or deploying.
- Do not commit, push, force, reset, clean, or apply a real migration. The owner will decide integration.
- Preserve unrelated .freebuff changes and any dirty worktree files.
- Use `/home/yahiro/Documents/PROJECTS/BANTAYOG-worktrees/merchant-apk` for Urban development and
  `/home/yahiro/Documents/PROJECTS/BANTAYOG-worktrees/merchant-apk-rural` for Rural development.
  Create Rural only from the reviewed buildable shared baseline commit.
- The two worktrees are development isolation only. Build both final signed APKs from one clean,
  approved integration revision and record that revision in both artifacts.
- Never commit an APK, AAB, keystore, signing properties file, password, or private key.
- Before completion, run pnpm lint, pnpm type-check, and pnpm test. Also run the affected package tests after every server, schema, or database change.
- A build or unit test does not prove a real offline-to-online sale. Physical acceptance needs an official transaction ID and stored server audit evidence.
- Do not add GCash, GoTyme, bank-account transfers, provider API calls, provider credentials, or
  real-money payout UI. These are future partnership plans only and require a later approved ADR.
- Before the demo, verify the selected image-capable Gemini model against the official pricing and
  data-use notice. Use no paid automatic upgrade. Send product-only crops and no beneficiary,
  guardian, merchant, PIN, pass, or transaction data. Real-user use requires a privacy review.

## Execution Checkout and Worktree Gate

- The main checkout at `/home/yahiro/Documents/PROJECTS/BANTAYOG` holds this ADR, design, and plan.
- Urban APK development uses the existing linked worktree at
  `/home/yahiro/Documents/PROJECTS/BANTAYOG-worktrees/merchant-apk/apps/mobile` on branch
  `feat/merchant-apk`.
- Rural APK development uses a new linked worktree at
  `/home/yahiro/Documents/PROJECTS/BANTAYOG-worktrees/merchant-apk-rural` on branch
  `codex/rural-merchant-apk`. Task 0 creates it only after the shared Android baseline is complete,
  reviewed, buildable, and available as an immutable Git commit.
- The Urban mobile worktree has staged generated Android files and unrelated work in progress. Preserve
  those files. Do not copy, reset, clean, commit, or merge them without owner instruction.
- In the current snapshot, `apps/mobile/package.json` and `apps/mobile/capacitor.config.ts` are
  staged zero-byte files. Treat the Android shell as incomplete until Task 0 resolves them and the
  baseline build passes.
- The two worktrees are isolated developer checkouts, not separate codebases. Shared server,
  schema, web, barcode, and Android baseline changes must have the same reviewed content in both
  branches. Rural-only classes stay in the Rural source set.
- Before Task 1 starts, the owner must approve how the reviewed documents and current server/web
  code enter the shared baseline and must explicitly authorize the baseline commit. The executor
  must run the `superpowers:using-git-worktrees` safety check before it creates the Rural worktree.
- Intermediate Urban builds run in `merchant-apk`. Intermediate Rural builds run in
  `merchant-apk-rural`. The final Urban and Rural release APKs must be built from one clean,
  owner-approved integration revision so shared security and catalog behavior cannot drift.
- The existing Android shell uses `android/app/build.gradle`, not `build.gradle.kts`. It uses the
  namespace `ph.bantayog.merchant`, a Java `MainActivity`, minSdk 24, compileSdk 36, targetSdk 36,
  Android Gradle Plugin 8.13.0, and Gradle 8.14.3.
- Adding Kotlin, SQLCipher, WorkManager, ML Kit, or OpenCV is still a native dependency gate. The
  owner must approve the exact dependency set before installation.

## Model and Reasoning Routing

The model setting is an execution aid. It does not replace tests, approval gates, physical-device
checks, or server audit evidence.

The owner has about 30 percent of the weekly ChatGPT Plus allowance left. This routing is a usage
target. It is not a guarantee. Provider meters depend on the amount of work, retries, context, and
tool use. Stop a Sol checkpoint if it expands into implementation work.

Use these executors:

- Use `gpt-5.6-sol` only for the three security checkpoints below. Sol does not own a full
  implementation task in this revision.
- Use Freebuff with `DeepSeek V4 Flash 0731` for Tasks 0, 1, 4, 6, 8, and 10. Use `max` reasoning
  for Tasks 0, 1, 4, 6, and 10. Use `high` reasoning for Task 8.
- Use the Antigravity free tier with `Gemini 3.6 Flash (High)` for Tasks 2, 3, 5, 7, and 9.
  Google currently lists this model and effort on the free tier. If it is not in the model picker,
  use `Gemini 3.5 Flash (High)` and record the exact selected label. Do not silently change to a
  Pro, Claude, or paid-overage model.
- Keep `gpt-5.6-luna` and `gpt-5.6-terra` as emergency fallbacks only. A fallback needs owner
  approval and must record the exact model and effort in the task handoff.

The Antigravity free tier has a weekly limit. Its available capacity can change. Check the Models
page before each Antigravity task. Do not enable paid AI credit overages.

### Front-loaded Sol security checkpoints

Run all three Sol checkpoints after Task 1 freezes the contracts and before Tasks 2, 3, 5, or 7
write implementation code. Each checkpoint produces a short review artifact and acceptance-test
list. It must not implement the full task.

1. **Sol checkpoint A — database authority:** Use `gpt-5.6-sol` with `xhigh` reasoning. Review the
   Task 2 SQL transaction boundary, integer-credit math, reservation invariants, idempotency, RLS,
   and seven-merchant concurrency cases.
2. **Sol checkpoint B — cryptographic authority:** Use `gpt-5.6-sol` with `xhigh` reasoning. Review
   the Task 3 canonical bytes, key domains, QR and certificate verification, PIN verifier design,
   replay protection, and cross-language test vectors.
3. **Sol checkpoint C — offline consumption and sync authority:** Use `gpt-5.6-sol` with `high`
   reasoning. Review the Task 5 and Task 7 permit-consumption state machine, trusted-time rules,
   process-death behavior, server receipt order, conflict handling, and merchant-balance rules.

Checkpoint review on 2026-08-05:

- Checkpoint A is blocked. See
  [Sol Checkpoint A: Database Authority Review](../../handoff/reviews/SOL_CHECKPOINT_A_DATABASE_AUTHORITY.md).
- Checkpoint B is blocked. See
  [Sol Checkpoint B: Cryptographic Authority Review](../../handoff/reviews/SOL_CHECKPOINT_B_CRYPTOGRAPHIC_AUTHORITY.md).
- Checkpoint C is blocked. See
  [Sol Checkpoint C: Offline Consumption and Sync Authority Review](../../handoff/reviews/SOL_CHECKPOINT_C_OFFLINE_SYNC_AUTHORITY.md).
- Complete the small Task 1 contract correction before Tasks 2, 3, 5, or 7 start. Do not treat
  green Task 1 tests as approval of the missing invariants.

Each Sol checkpoint must use only the ADR, frozen contracts, relevant task section, and focused
diffs or schemas. Do not load the complete repository when a smaller context is sufficient. After
the three checkpoints, use Freebuff and Antigravity for implementation, tests, build repair, and
acceptance evidence. If a later test exposes a new security-design defect, stop and use
`gpt-5.6-luna` with `xhigh` after owner approval. Do not spend more Sol usage by default.

### Executor isolation and data safety

- Use one executor in a worktree at one time. Do not let Freebuff and Antigravity edit the same
  worktree concurrently.
- Give each executor only its task section, approved review artifact, allowed paths, and required
  tests. Require a status and diff check before and after each task.
- Do not send `.env` files, keys, tokens, keystores, passwords, production beneficiary data, or
  production transaction data to any model provider. Use fake data in tests.
- Do not let an executor stage, unstage, commit, merge, deploy, apply a migration, sign an APK, or
  add a dependency unless the owner gives explicit permission for that action.
- A DeepSeek or Gemini result is not accepted because the model completed it. Accept it only after
  the task tests, repository gates, and required checkpoint conditions pass.

### Time boundary

The complete plan cannot be implemented, integrated, signed, and physically accepted in one or two
hours. Tasks 0, 2, 3, 5, 7, 9, and 10 contain sequential approval, build, database, cryptographic,
or physical-device gates. A two-hour sprint may complete the baseline recovery and a small tested
implementation slice. It must not be reported as the completed Rural system or as two final APKs.

For the shortest safe wall time:

1. Run Task 0 and Task 1 in sequence.
2. After Task 1 passes, run Sol checkpoints A, B, and C. Run no other Sol work by default.
3. After all three checkpoint artifacts pass owner review, run Task 2, Task 3, and Task 6 as
   isolated implementation streams. Do not let two streams edit the same schema or server
   registration file. Integrate one reviewed commit at a time.
4. Run Task 4 after Tasks 2 and 3. Run Task 7 after Tasks 3 and 6.
5. Run Task 5 after Tasks 2, 3, and 4. Run Task 8 after Tasks 4, 6, and 7.
6. Run Task 9 only after Tasks 0 through 8 pass. Run Task 10 last.

Stop a time box instead of lowering a security check. Record the incomplete step and continue in a
new session with the same model and effort.

| Task | Executor and model | Effort | Required Sol checkpoint | First-pass time box |
| --- | --- | --- | --- | ---: |
| 0 — baseline and worktrees | Freebuff — DeepSeek V4 Flash 0731 | `max` | None | 20 min |
| 1 — contracts and pure rules | Freebuff — DeepSeek V4 Flash 0731 | `max` | None | 30 min |
| 2 — database atomicity | Antigravity — Gemini 3.6 Flash | `high` | A | 90 min |
| 3 — QR, keys, device, and PIN | Antigravity — Gemini 3.6 Flash | `high` | B | 90 min |
| 4 — search and provisioning | Freebuff — DeepSeek V4 Flash 0731 | `max` | A and B | 60 min |
| 5 — synchronization and settlement | Antigravity — Gemini 3.6 Flash | `high` | A, B, and C | 90 min |
| 6 — catalog and product validation | Freebuff — DeepSeek V4 Flash 0731 | `max` | None | 75 min |
| 7 — native Rural edge | Antigravity — Gemini 3.6 Flash | `high` | B and C | 120 min |
| 8 — Urban and Rural UI | Freebuff — DeepSeek V4 Flash 0731 | `high` | None | 60 min |
| 9 — variants and final APKs | Antigravity — Gemini 3.6 Flash | `high` | None | 90 min |
| 10 — end-to-end acceptance | Freebuff — DeepSeek V4 Flash 0731 | `max` | All findings enforced | 120 min |

These first-pass budgets total about 14 hours when run in sequence. The dependency waves reduce the
ideal active critical path to about nine hours before owner approvals, Gradle or package downloads,
test failures, signing-key setup, and physical-device work. Treat this as a routing estimate, not a
delivery promise.

---

## File Map

**Shared contracts and pure rules**

- Create: packages/schema/src/offline.ts
- Create: packages/schema/src/offline.test.ts
- Modify: packages/schema/src/index.ts
- Create: apps/server/src/domain/offline-reservation.ts
- Create: apps/server/src/domain/offline-reservation.test.ts
- Create: apps/server/src/domain/offline-event.ts
- Create: apps/server/src/domain/offline-event.test.ts
- Create: apps/server/src/domain/offline-fallback.ts
- Create: apps/server/src/domain/offline-fallback.test.ts

**Server and database**

- Create: supabase/migrations/00011_offline_authorization.sql, using the next unused number if the migration list changes before execution.
- Modify: packages/db/src/types.ts
- Modify: packages/db/src/types.test.ts
- Create: apps/server/src/repositories/merchant-device.repository.ts
- Create: apps/server/src/repositories/beneficiary-merchant-assignment.repository.ts
- Create: apps/server/src/repositories/offline-merchant-certificate.repository.ts
- Create: apps/server/src/repositories/offline-credit-reservation.repository.ts
- Create: apps/server/src/repositories/offline-transaction-event.repository.ts
- Create: apps/server/src/repositories/offline-sync-receipt.repository.ts
- Create: apps/server/src/repositories/offline-catalog-release.repository.ts
- Create: apps/server/src/repositories/offline-conflict-review.repository.ts
- Create: apps/server/src/services/merchant-beneficiary-search.service.ts
- Create: apps/server/src/services/merchant-beneficiary-search.service.test.ts
- Create: apps/server/src/services/offline-provisioning.service.ts
- Create: apps/server/src/services/offline-provisioning.service.test.ts
- Create: apps/server/src/services/offline-sync.service.ts
- Create: apps/server/src/services/offline-sync.service.test.ts
- Create: apps/server/src/services/offline-crypto.service.ts
- Create: apps/server/src/services/offline-crypto.service.test.ts
- Create: apps/server/src/services/offline-pin-verifier.service.ts
- Create: apps/server/src/services/offline-pin-verifier.service.test.ts
- Create: apps/server/src/services/offline-catalog-release.service.ts
- Create: apps/server/src/services/offline-catalog-release.service.test.ts
- Create: apps/server/src/services/offline-conflict.service.ts
- Create: apps/server/src/services/offline-conflict.service.test.ts
- Create: apps/server/src/routes/offline.ts
- Create: apps/server/src/routes/admin-offline.ts
- Modify: apps/server/src/routes/merchant-self.ts
- Modify: apps/server/src/routes/transactions.ts
- Modify: apps/server/src/routes/balance.ts
- Modify: apps/server/src/services/qr-token.service.ts
- Modify: apps/server/src/services/qr-token.service.test.ts
- Modify: apps/server/src/routes/transactions.ts
- Modify: apps/server/src/routes/balance.ts
- Modify: apps/server/src/services/vision.service.ts
- Modify: apps/server/src/services/vision.service.test.ts
- Modify: apps/server/src/services/pricing-validation.service.ts
- Modify: apps/server/src/services/pricing-validation.service.test.ts
- Modify: apps/server/src/routes/cron/index.ts
- Create: apps/server/src/routes/cron/offline-release-expired.ts
- Modify: apps/server/src/app.ts
- Modify: apps/server/src/lib/errors.ts when new tagged failures need stable mappings
- Modify: apps/server/src/dto/mappers.ts and its snapshot when API DTOs change

**Web and mobile edge**

- Create: apps/web/lib/merchant/variant.ts
- Create: apps/web/lib/merchant/variant.test.ts
- Create: apps/web/lib/offline/catalog.ts
- Create: apps/web/lib/offline/catalog.test.ts
- Create: apps/web/lib/offline/product-validator.ts
- Create: apps/web/lib/offline/product-validator.test.ts
- Create: apps/web/lib/offline/merchant-edge.ts
- Create: apps/web/lib/offline/merchant-edge.test.ts
- Create: apps/web/lib/offline/fallback-policy.ts
- Create: apps/web/lib/offline/fallback-policy.test.ts
- Create: apps/web/lib/product/barcode-adapter.ts
- Create: apps/web/lib/product/barcode-adapter.test.ts
- Create: apps/web/components/merchant/beneficiary-search.tsx
- Create: apps/web/lib/offline/fallback-policy.ts
- Create: apps/web/lib/offline/fallback-policy.test.ts
- Modify: apps/web/app/(merchant)/checkout/page.tsx
- Modify: apps/web/lib/api.ts only for the online name-search request and variant-safe API handling
- Create or modify: apps/mobile/package.json
- Create or modify: apps/mobile/capacitor.config.ts
- Modify: apps/mobile/android/build.gradle
- Modify: apps/mobile/android/app/build.gradle
- Move: apps/mobile/android/app/src/main/java/ph/bantayog/merchant/MainActivity.java to
  apps/mobile/android/app/src/urban/java/ph/bantayog/merchant/MainActivity.java
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/MainActivity.java
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/MerchantEdgePlugin.kt
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/OfflineDatabase.kt
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/DeviceKeyStore.kt
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/OfflineSyncWorker.kt
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/TrustedTimeStore.kt
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/LocalRetentionWorker.kt
- Create: apps/mobile/android/app/src/main/java/ph/bantayog/merchant/BarcodeScannerPlugin.kt
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/TrustedTimeStore.kt
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/LocalRetentionWorker.kt
- Create: apps/mobile/android/app/src/testRural/java/ph/bantayog/merchant/OfflineDatabaseTest.kt
- Create: apps/mobile/android/app/src/androidTestRural/java/ph/bantayog/merchant/OfflineSaleInstrumentedTest.kt

**Documentation and verification**

- Create: docs/MOBILE_BUILD.md
- Modify: docs/adr/004-rural-offline-quota-authorization.md only when the owner approves a decision change
- Keep the already updated docs/context, docs/SECURITY.md, and .kiro/steering files aligned with implementation state
- Do not mark the Rural feature as implemented until the device and server audit gates pass

---

### Task 0: Restore the Urban baseline and create the Rural worktree

**Executor and model:** Freebuff with `DeepSeek V4 Flash 0731`.

**Reasoning effort:** `max`. Do not escalate this task to Sol. Use the controlling Task 0 handoff
and stop at each owner gate.

**First-pass time box:** 20 minutes for inspection and the proposed repair. Build, approval, and
dependency download time are outside this time box.

**Files:**
- Review without overwrite: all staged files under `apps/mobile` in the `merchant-apk` worktree.
- Complete after owner approval: `apps/mobile/package.json`.
- Complete after owner approval: `apps/mobile/capacitor.config.ts`.
- Modify only if the baseline requires it: `pnpm-workspace.yaml` and `.gitignore`.
- Create after the baseline commit: linked worktree
  `/home/yahiro/Documents/PROJECTS/BANTAYOG-worktrees/merchant-apk-rural`.

**Interfaces:**

- Package name: `@bantayog/mobile`.
- Capacitor app ID: `ph.bantayog.merchant`.
- Capacitor app name: `BANTAYOG Merchant`.
- Web directory: `../web/out` for the baseline shell.
- Start path: `/merchant-login`.
- Release origin: `https://localhost`.
- Release API base: absolute HTTPS. No local host, private-network host, or `server.url`.

- [ ] Step 1: Run the `superpowers:using-git-worktrees` safety check. Record the main checkout and
  the existing Urban worktree, branch, `git status --short`, staged files, unstaged files, `HEAD`,
  Git directory, and common Git directory. Confirm that no Rural worktree or Rural branch exists.
- [ ] Step 2: Compare the zero-byte package and Capacitor files with the approved mobile handoff
  and the staged generated Android project. Present the exact proposed file contents to the owner.
- [ ] Step 3: Stop for owner approval of the worktree integration method and the two file contents.
  Do not overwrite the staged placeholders before approval.
- [ ] Step 4: After approval, complete the package and Capacitor files. Keep Capacitor 8.4.2 and
  the existing `ph.bantayog.merchant` identity. Do not add Rural dependencies yet.
- [ ] Step 5: Bring the reviewed ADR, design, plan, and required current server/web code into the
  Urban worktree by the owner-approved method. Preserve unrelated changes.
- [ ] Step 6: Run the existing merchant mobile export, Capacitor sync, Gradle unit tests, and the
  Urban debug build with JDK 21. Record the exact commands and results.
- [ ] Step 7: Stop if the baseline does not build or if the generated shell differs from the
  recorded namespace, SDK levels, Android Gradle Plugin, or Gradle wrapper.
- [ ] Step 8: Stop for explicit owner authorization to record the complete, reviewed shared
  baseline as a Git commit. Do not create a commit only because this plan needs a worktree.
- [ ] Step 9: After the owner provides the immutable baseline commit, verify that the target path
  and branch do not already exist. Create the Rural worktree from that exact commit:

```bash
git worktree add /home/yahiro/Documents/PROJECTS/BANTAYOG-worktrees/merchant-apk-rural \
  -b codex/rural-merchant-apk <reviewed-baseline-commit>
```

- [ ] Step 10: In the Rural worktree, run dependency setup, the same mobile export, Capacitor sync,
  Gradle unit tests, and the baseline debug build with JDK 21. Stop if this clean baseline fails.
- [ ] Step 11: Record the two-worktree ownership table in `docs/MOBILE_BUILD.md`: `merchant-apk`
  owns Urban development, `merchant-apk-rural` owns Rural development, shared commits must be
  present in both, and final APKs come from one approved integration revision.

---

### Task 1: Freeze shared offline contracts and pure reservation rules

**Executor and model:** Freebuff with `DeepSeek V4 Flash 0731`.

**Reasoning effort:** `max` because names and canonical payload fields become dependencies for all
later tasks.

**First-pass time box:** 30 minutes. Stop at a failing test or contract mismatch; do not improvise a
new field outside ADR-004.

**Files:**
- Create: packages/schema/src/offline.ts
- Create: packages/schema/src/offline.test.ts
- Modify: packages/schema/src/index.ts
- Create: apps/server/src/domain/offline-reservation.ts
- Create: apps/server/src/domain/offline-reservation.test.ts
- Create: apps/server/src/domain/offline-event.ts
- Create: apps/server/src/domain/offline-event.test.ts

**Interfaces:**

- MerchantAppVariant: URBAN or RURAL.
- MerchantDeviceStatus: PENDING, ACTIVE, REVOKED, or EXPIRED.
- OfflineReservationStatus: ACTIVE, CONSUMED, EXPIRED, RELEASED, or REVOKED.
- OfflineEventDecision: ACCEPTED, REJECTED, or CONFLICT.
- ProductIdentificationMethod: ONLINE_BARCODE, ONLINE_GEMINI, OFFLINE_BARCODE, OFFLINE_OCR, or
  OFFLINE_MANUAL_COMMODITY.
- OfflineFallbackDecision: USE_LOCAL_EVENT, RETRY_CAPTURE, REQUIRE_LOGIN, BLOCK_POLICY, or
  BLOCK_CONFIGURATION.
- MAX_ACTIVE_RURAL_MERCHANTS_PER_BENEFICIARY: 7.
- OfflineReservationInput: assignmentId, beneficiaryId, merchantId, deviceId, maximumCredits, issuedAt,
  expiresAt, catalogVersion, policyVersion, nonce.
- OfflineEventInput: eventId, saleId, transactionId, assignmentId, reservationId, beneficiaryId,
  merchantId, deviceId, amountCredits, items, identificationMethod, catalogVersion, policyVersion,
  authorizationMethod, pinVerifierVersion, merchantCertificateVersion, failedPinAttemptCount,
  pinSuccessfulUseOrdinal, localSequence, createdAt, payloadHash, signature.
- OfflineSyncResult: eventId, decision, officialTransactionId, reason, serverCursor.
- computeAvailableOfflineCredits(creditBalance: bigint, activeRemainingCredits: bigint[]): bigint.
- countDistinctActiveRuralMerchants(activeReservations: Array<{ merchantId: string;
  remainingCredits: bigint }>): number.
- canIssueOfflineReservation(input: { creditBalance: bigint; activeReservations: Array<{
  merchantId: string; remainingCredits: bigint }>; merchantId: string;
  requestedCredits: bigint; merchantPolicyCapCredits: bigint }): boolean.
- consumeOfflineReservation(remainingCredits: bigint, saleCredits: bigint): {
  remainingCredits: bigint; status: OfflineReservationStatus }.
- canonicalizeOfflineEvent(input: OfflineEventInput): Uint8Array.
- classifyOfflineEventConflict(input): OfflineEventDecision.
- decideOfflineFallback(input: { variant: MerchantAppVariant; hasActiveAssignment: boolean;
  hasValidPermit: boolean; hasPinnedCatalog: boolean; hasMerchantCertificate: boolean;
  hasBeneficiaryVerifier: boolean; failureKind: string; httpStatus?: number }):
  OfflineFallbackDecision.

- [ ] Step 1: Write schema tests for Urban and Rural variants, reservation statuses, event
  decisions, decimal-string integer-credit parsing, and rejection of negative, fractional, or
  unsafe JavaScript-number amounts.
- [ ] Step 2: Run pnpm --filter @bantayog/schema test and pnpm --filter @bantayog/schema type-check. Confirm the new tests fail before implementation.
- [ ] Step 3: Implement the Zod schemas and export them from packages/schema/src/index.ts.
- [ ] Step 4: Write failing domain tests for the cross-merchant example: balance 1,000, Store A 300, Store B 200, available 500; a new 501-credit reservation must fail; a 300-credit sale leaves zero for Store A. Add seven distinct merchants, reject the eighth, and prove that two devices for one merchant count as one merchant.
- [ ] Step 4A: Write failing fallback tests for network, DNS, timeout, 408, 429, and 5xx. Require
  local event fallback only when all five Rural prerequisites are valid. Test no fallback for a
  valid ineligible result, 400, 401, 403, invalid signature, invalid catalog, and invalid configuration.
- [ ] Step 5: Run pnpm --filter @bantayog/server test -- offline-reservation and confirm the domain functions are missing or fail for the expected reason.
- [ ] Step 6: Implement the pure reservation, event, and fallback functions. Use bigint or
  decimal-string conversion at the boundary. Do not use JavaScript floating-point money math.
- [ ] Step 7: Run pnpm --filter @bantayog/schema test, pnpm --filter @bantayog/server test, pnpm type-check, and pnpm lint.
- [ ] Step 8: Stop for owner review if the shared names or payload fields differ from ADR-004.

---

### Task 2: Add the database objects and reservation-aware SQL atomicity

**Executor and model:** Antigravity free tier with `Gemini 3.6 Flash`.

**Reasoning effort:** `high`. Sol checkpoint A must approve the SQL invariants and acceptance-test
list before implementation starts. If Gemini 3.6 Flash is unavailable, use Gemini 3.5 Flash with
`high` and record the exact picker label.

**First-pass time box:** 90 minutes for migration, type, and disposable-database tests after the
required approvals. Do not reduce SQL concurrency tests to meet the time box.

**Files:**
- Create: supabase/migrations/00011_offline_authorization.sql, or the next unused migration number.
- Modify: packages/db/src/types.ts
- Modify: packages/db/src/types.test.ts
- Modify: packages/db/src/repository.ts only if a typed helper is needed for a new RPC.

**Interfaces:**

The migration must add these logical objects:

- merchant_devices: id, merchant_id, app_variant, device_public_key, key_algorithm, attestation_jsonb, status, registered_at, last_seen_at, revoked_at.
- beneficiary_merchant_assignments: id, beneficiary_id, merchant_id, policy_cap_credits,
  valid_from, valid_until, status, approved_by, approved_at, revoked_by, revoked_at, audit_reason.
- offline_merchant_certificates: id, merchant_id, device_id, capabilities_jsonb, issued_at,
  expires_at, certificate_version, key_id, algorithm, signature, status.
- offline_credit_reservations: id, assignment_id, beneficiary_id, merchant_id, device_id,
  maximum_credits NUMERIC(12,2), remaining_credits NUMERIC(12,2), issued_at, expires_at,
  catalog_version, policy_version, nonce, permit_signature, status, released_by, released_at,
  release_reason, created_at, updated_at.
- offline_transaction_events: id, sale_id, transaction_id, assignment_id, reservation_id,
  beneficiary_id, merchant_id, device_id, local_sequence, identification_method, payload_jsonb,
  payload_hash, event_signature, amount_credits NUMERIC(12,2), device_created_at, decision,
  decision_reason, received_at, decided_at.
- offline_sync_receipts: id, event_id, decision, official_transaction_id, reason, server_cursor, created_at.
- offline_catalog_releases: id, catalog_version, policy_version, payload_jsonb, payload_digest,
  valid_from, valid_until, key_id, algorithm, signature, status, created_by, created_at.
- offline_conflict_reviews: id, event_id, action, actor_id, reason, remediation_transaction_id,
  created_at. Rows are append-only.

The migration must add:

- Foreign keys and indexes for beneficiary, merchant, device, reservation, event, status, expiry, and idempotency lookups.
- Check constraints for non-negative credits, valid variants, valid statuses, one event ID per
  event, one immutable payload per sale ID, valid identification methods, and no overlapping active
  duplicate assignment for the same beneficiary and merchant.
- Check constraints that require `maximum_credits`, `remaining_credits`, and `amount_credits` to be
  whole values with `.00`.
- RLS policies for admin visibility and merchant ownership. The API uses the service role, so route ownership checks remain mandatory.
- An assignment approval function that locks the beneficiary row and rejects an eighth active
  distinct Rural merchant assignment. A merchant cannot call this function.
- A reservation issuance function that locks the beneficiary row, requires the active assignment,
  sums active reservation remaining amounts, applies the server policy and assignment caps, and
  rejects over-reservation.
- The reservation issuance function must count active distinct Rural `merchant_id` values while the
  beneficiary row is locked. It may issue a permit to the seventh distinct merchant, must reject a
  new permit for an eighth distinct merchant, and must count multiple devices for one merchant as
  one merchant. A policy may configure a lower limit, never a higher one.
- The same locked issuance function must enforce the aggregate per-merchant policy cap across all
  active device reservations for that beneficiary and merchant.
- An expiry/release function that closes expired reservations. It must not increment
  `beneficiaries.credit_balance`; release only removes the reservation from the active sum.
- A manual release function that requires the owning merchant or an administrator and stores the
  actor, reason, and server time. It uses the same no-credit-increment rule.
- A reservation-aware online settlement path. The existing settle_sale signature may stay stable, but its locked balance check must subtract active reservations.
- A separate reservation-aware offline settlement function that claims the event ID, locks the
  beneficiary and reservation, validates current database state and server receipt-time expiry,
  consumes the reservation, deducts beneficiary credit, credits merchant wallet_balance, inserts
  one official transaction, stores the final event decision, and inserts the sync receipt atomically.
- A decision-recording function for rejected and conflicting events that stores the event and its
  receipt in one transaction without moving money.
- A unique idempotency guard so a repeated offline event returns its original decision and official transaction ID.

- [ ] Step 1: Confirm that migrations 00001 through 00010 are present and applied-state is unknown. Do not edit them. Ask the owner before applying any migration to a real Supabase project.
- [ ] Step 2: Extend the database type tests first. Add row fixtures and function argument/return
  types for all eight new tables and the new RPCs.
- [ ] Step 3: Run pnpm --filter @bantayog/db test and pnpm --filter @bantayog/db type-check. Confirm the new type tests fail before types are added.
- [ ] Step 4: Add the next append-only migration with the tables, constraints, indexes, RLS
  policies, and SQL functions. Use `NUMERIC(12,2)` for database money and reject fractional credit
  amounts at the RPC boundary.
- [ ] Step 5: Update packages/db/src/types.ts and packages/db/src/types.test.ts to match the migration exactly. Keep the current transaction status values unchanged.
- [ ] Step 6: Run pnpm --filter @bantayog/db test, pnpm --filter @bantayog/db type-check, pnpm type-check, and pnpm lint.
- [ ] Step 7: Run SQL review checks against a disposable local or test database only. Verify two concurrent reservation requests cannot over-reserve one beneficiary.
- [ ] Step 8: Run SQL review checks against seven distinct merchant requests and an eighth
  request. Verify the seventh is policy-allowed, the eighth is rejected, and all devices for one
  merchant stay inside one aggregate merchant cap.
- [ ] Step 8A: Verify that an unassigned merchant cannot search, provision, create a verifier, or
  reserve credits. Verify that a merchant cannot self-approve an assignment.
- [ ] Step 9: Test expiry with server receipt time. Prove that a backdated device timestamp does
  not extend a permit and that release does not change `credit_balance`.
- [ ] Step 9A: Test manual merchant and administrator release. Verify actor and reason audit fields,
  idempotent repeat release, ownership rejection, and no credit increment.
- [ ] Step 10: Test the accepted-event RPC with an injected failure before receipt insertion.
  Prove that reservation consumption, balances, transaction, event decision, and receipt all roll
  back. Then prove that one successful call commits all six effects.
- [ ] Step 11: Stop for owner approval before touching the live database, settle_sale,
  authentication, or RLS policies.

---

### Task 3: Implement asymmetric signing, device registration, and Rural PIN provisioning

**Executor and model:** Antigravity free tier with `Gemini 3.6 Flash`.

**Reasoning effort:** `high`. Sol checkpoint B must approve the cryptographic boundaries and test
vectors before implementation starts. If Gemini 3.6 Flash is unavailable, use Gemini 3.5 Flash
with `high` and record the exact picker label.

**First-pass time box:** 90 minutes after the QR, authentication, and native dependency approvals.
Stop if cross-language signature vectors or key rotation tests do not pass.

**Files:**
- Create: apps/server/src/services/offline-crypto.service.ts
- Create: apps/server/src/services/offline-crypto.service.test.ts
- Create: apps/server/src/services/offline-pin-verifier.service.ts
- Create: apps/server/src/services/offline-pin-verifier.service.test.ts
- Modify: apps/server/src/services/qr-token.service.ts
- Modify: apps/server/src/services/qr-token.service.test.ts
- Create: apps/server/src/lib/qr/config.ts
- Modify: apps/mobile/android/build.gradle after the native dependency gate.
- Modify: apps/mobile/android/app/build.gradle after the native dependency gate.
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/DeviceKeyStore.kt
- Create: apps/web/lib/offline/qr-verifier.ts
- Create: apps/web/lib/offline/qr-verifier.test.ts
- Modify: turbo.json if new public verification-key environment variables are introduced.

**Interfaces:**

- canonicalizePermit(payload): Uint8Array.
- signPermit(payload, serverPrivateKey): Promise<string>.
- verifyPermit(payload, signature, serverPublicKey): Promise<boolean>.
- canonicalizeOfflineEvent(payload): Uint8Array.
- signOfflineEvent(payload, devicePrivateKey): Promise<string>.
- verifyOfflineEvent(payload, signature, devicePublicKey): Promise<boolean>.
- signOfflineMerchantCertificate(payload, permitPrivateKey): Promise<string>.
- verifyOfflineMerchantCertificate(payload, signature, permitPublicKey): Promise<boolean>.
- resolveTrustedPublicKey(input: { trustDomain: QR | PERMIT | CATALOG; keyId: string;
  algorithm: ES256; formatVersion: number; effectiveAt: Date }): AppResult<CryptoKey>.
- provisionOfflinePinVerifier(pin, beneficiaryId, deviceId, verifierVersion): Promise<OfflinePinVerifierPackage>.
- verifyOfflinePin(pin, verifierPackage, attemptState): Promise<{ verified: boolean; locked: boolean }>.
- DeviceKeyStore.generateOrLoadKeyPair(): public key plus private-key handle.
- DeviceKeyStore.sign(canonicalBytes): signature. The private key must not leave Android Keystore.

Use ES256/P-256 after the owner approves the compatibility test. Use separate key pairs for QR,
permit, and catalog trust domains. Use one canonical payload encoding per object type. Include an
algorithm, key ID, and format version in every signed package. Rotation must support an overlap
period in which old and new public keys verify already issued valid objects.

QR pass version 2 contains only issuer, audience, pass ID, opaque beneficiary reference, pass
version, key ID, issue time, expiry, and revocation version. It contains no names, wallet reference,
balance, PIN hash, or PIN reference. Every route that accepts a pass checks expiry and revocation.

The Rural PIN design is a separate context-bound, memory-hard verifier generated after an online
PIN check. It is encrypted with a Keystore-protected AES-GCM key and is never accepted by an online
endpoint. Five failures lock offline no-card payment until online re-provisioning. The signed
verifier policy contains per-sale, total-amount, and successful-event limits. Missing limits fail
closed. The controlled-pilot upper limits are 200 credits per sale, 500 credits in total per
verifier, and three successful no-card events. Select the memory-hard parameters through the
required low-end benchmark before rollout.
Do not copy `pin_hash_argon2id`.

- [ ] Step 1: Write server crypto tests for canonical payload stability, signature verification, changed-field rejection, wrong-key rejection, key-version rejection, and signature algorithm mismatch.
- [ ] Step 2: Write QR regression tests that reject the current HMAC fallback and accept only the configured asymmetric public key.
- [ ] Step 2A: Add pass-route tests for authentication, transactions, balance, provisioning, and
  synchronization. Each route must reject an expired or revoked pass. Test the minimal payload and
  prove that private fields are absent.
- [ ] Step 2B: Add independent key-rotation tests for QR, permit, and catalog keys. Test old/new
  overlap, retired key rejection after the overlap, wrong trust domain, wrong key ID, wrong
  algorithm, and an unauthenticated key-update rejection.
- [ ] Step 3: Write PIN verifier tests for correct PIN, incorrect PIN, five-attempt permanent
  offline lock, online re-provision unlock, expiry, wrong beneficiary, wrong device, missing signed
  limits, per-sale limit, total limit, event-count limit, and verifier replay against another
  endpoint.
- [ ] Step 4: Run the focused server and web tests and confirm the new crypto tests fail for the intended missing implementation.
- [ ] Step 5: Implement server signing and verification through jose. Read private keys only from explicit server environment configuration. Never use a development fallback in deployed code.
- [ ] Step 5A: Regenerate demo QR passes as version 2 only after the owner approves the data reset.
  Do not create a compatibility HMAC fallback.
- [ ] Step 6: Stop for owner approval before changing QR signing in a deployed environment or
  adding Kotlin or a native cryptography dependency.
- [ ] Step 7: After approval, configure Kotlin and the `connectivity` flavor dimension with empty
  `urban` and `rural` flavors in the existing Groovy Gradle files. Then implement the native device
  key generation and signing bridge. Add a test vector shared by Kotlin and TypeScript.
- [ ] Step 8: Implement the approved separate offline PIN verifier package. Log no PIN or verifier
  value. Encrypt the package at rest. Put the authorization method, verifier version,
  failed-attempt count, and successful-use ordinal in the signed sale event. Enforce the amount and
  accepted-event limits again on the server.
- [ ] Step 9: Bundle only trusted public verification metadata in the Rural artifact. Prove with an
  artifact scan that no private key or HMAC minting secret is present. Verify that QR, permit, and
  catalog key IDs cannot be substituted across trust domains.
- [ ] Step 10: Run pnpm --filter @bantayog/server test, pnpm --filter @bantayog/web test, pnpm type-check, and pnpm lint.

---

### Task 4: Add merchant beneficiary search and Rural provisioning services

**Executor and model:** Freebuff with `DeepSeek V4 Flash 0731`.

**Reasoning effort:** `max` for authorization, assignment ownership, provisioning minimization,
and certificate capability checks. Enforce the approved outputs from Sol checkpoints A and B.

**First-pass time box:** 60 minutes after Tasks 2 and 3. Stop if the response can expose a balance,
PIN material, unassigned beneficiary, or excessive PII.

**Files:**
- Create: apps/server/src/repositories/merchant-device.repository.ts
- Create: apps/server/src/repositories/beneficiary-merchant-assignment.repository.ts
- Create: apps/server/src/repositories/offline-merchant-certificate.repository.ts
- Create: apps/server/src/repositories/offline-credit-reservation.repository.ts
- Create: apps/server/src/repositories/offline-transaction-event.repository.ts
- Create: apps/server/src/repositories/offline-sync-receipt.repository.ts
- Create: apps/server/src/services/merchant-beneficiary-search.service.ts
- Create: apps/server/src/services/merchant-beneficiary-search.service.test.ts
- Create: apps/server/src/services/offline-provisioning.service.ts
- Create: apps/server/src/services/offline-provisioning.service.test.ts
- Create: apps/server/src/services/offline-catalog-release.service.ts
- Create: apps/server/src/services/offline-catalog-release.service.test.ts
- Create: apps/server/src/routes/offline.ts
- Create: apps/server/src/routes/admin-offline.ts
- Modify: apps/server/src/routes/merchant-self.ts
- Modify: apps/server/src/app.ts
- Modify: packages/schema/src/offline.ts if response schemas need additions.
- Modify: apps/server/src/dto/mappers.ts and its snapshot if shared DTOs are changed.

**Interfaces:**

- searchMerchantBeneficiaries(merchantId, query, currentDate): AppResult<MaskedBeneficiarySearchResult[]>.
- registerRuralDevice(merchantId, request): AppResult<DeviceRegistration>.
- provisionRuralDevice(merchantId, deviceId, request: { beneficiaryId: string; pin: string }): AppResult<RuralProvisioningPackage>.
- createBeneficiaryMerchantAssignment(adminId, input): AppResult<BeneficiaryMerchantAssignment>.
- issueOfflineMerchantCertificate(merchantId, deviceId, currentDate):
  AppResult<OfflineMerchantCertificate>.
- releaseOfflineReservation(actor, reservationId, reason, currentDate):
  AppResult<OfflineReservationRelease>.
- createCatalogRelease(adminId, input): AppResult<ImmutableCatalogRelease>.
- RuralProvisioningPackage: deviceId, appVariant, catalogRelease, assignedBeneficiaries,
  activePermits, offlinePinVerifierPackages, offlineMerchantCertificate, trustedServerTime,
  keyMetadata, serverCursor.
- MaskedBeneficiarySearchResult: beneficiaryId, maskedChildName, maskedGuardianName, secondaryDisplayId. It must not contain balance, PIN, PIN hash, GPS, household profile, or private key.

Use merchant ownership checks in every service. The server must reject Urban devices from Rural
provisioning. The device record, not a client-supplied variant flag, controls access. The first
release requires the guardian PIN during an authenticated online provisioning or refresh step;
the server verifies it, creates a separate device-bound verifier package, and does not store the
raw PIN. The package has the five-attempt online-unlock rule and signed no-card amount and event
limits. Search must be bounded by query length, result count, merchant assignment, and rate limit.
An active administrator-approved assignment is required for search, verifier creation,
provisioning, and reservation issuance. The merchant cannot self-assign. The offline merchant
certificate grants local capabilities only; sync, provisioning, release, cash-out, and admin routes
require a fresh online session.

- [ ] Step 1: Write service tests for online Urban name search: approved merchant returns masked results; suspended merchant fails; short query fails; result does not contain balance or PIN; duplicate names return a secondary display ID.
- [ ] Step 2: Write provisioning tests for a Rural device, an Urban device, an unknown device, a revoked device, and a merchant-owned mismatch.
- [ ] Step 2A: Write assignment tests for admin approval, merchant self-assignment rejection,
  expired or revoked assignment, seven active distinct merchants, eighth merchant rejection, and
  two devices that share one merchant assignment.
- [ ] Step 3: Add provisioning tests for the seventh distinct Rural merchant, rejection of the eighth distinct merchant, and two devices for one existing merchant sharing one merchant allocation.
- [ ] Step 3A: Write offline merchant certificate tests for capability allowlist, device binding,
  expiry no later than the permit, wrong device, suspended merchant, and rejection by sync,
  provisioning, release, cash-out, and admin endpoints.
- [ ] Step 3B: Write catalog release tests for duplicate barcodes, ambiguous aliases, invalid
  categories, missing eligibility, invalid units, invalid price ranges, invalid dates, reused
  version, immutable canonical payload, digest, key ID, and signature.
- [ ] Step 3C: Write reservation release tests for owner, administrator, wrong merchant, missing
  reason, repeat release, and proof that `credit_balance` does not increase.
- [ ] Step 4: Run pnpm --filter @bantayog/server test and confirm the new tests fail for the intended missing services.
- [ ] Step 5: Implement thin repositories that only read and write the new tables. Keep policy in services and SQL functions.
- [ ] Step 6: Implement merchant-beneficiary-search.service.ts with live backend name search. Never use a PIN as a search key.
- [ ] Step 7: Implement offline-provisioning.service.ts. Return only the assigned directory, signed
  catalog, device-bound permit records, verifier packages, offline merchant certificate, trusted
  server time, trusted public-key metadata, and cursor. Do not return a full beneficiary balance list.
- [ ] Step 8: Add merchant authorization to GET /api/merchants/me/beneficiaries/search and Rural authorization to POST /api/offline/devices/register and POST /api/offline/provision.
- [ ] Step 8A: Add administrator routes for assignment and immutable catalog release creation. Add
  authenticated merchant and administrator reservation release routes. Keep mutation out of
  `/api/balance`.
- [ ] Step 9: Add rate limits and error mappings for search, device registration, and provisioning. Do not log names, PINs, tokens, or full provisioning packages.
- [ ] Step 10: Run pnpm --filter @bantayog/server test, pnpm type-check, pnpm lint, and pnpm test.
- [ ] Step 11: Stop for owner review of the exact response fields before the mobile client consumes the package.

---

### Task 5: Implement reservation-aware offline synchronization

**Executor and model:** Antigravity free tier with `Gemini 3.6 Flash`.

**Reasoning effort:** `high`. Sol checkpoints A, B, and C must approve the relevant invariants and
acceptance-test list before implementation starts. If Gemini 3.6 Flash is unavailable, use Gemini
3.5 Flash with `high` and record the exact picker label.

**First-pass time box:** 90 minutes after Tasks 2, 3, and 4. Do not skip replay, rollback, or
duplicate-sale tests to meet the time box.

**Files:**
- Create: apps/server/src/services/offline-sync.service.ts
- Create: apps/server/src/services/offline-sync.service.test.ts
- Modify: apps/server/src/routes/offline.ts
- Create: apps/server/src/routes/cron/offline-release-expired.ts
- Modify: apps/server/src/routes/cron/index.ts
- Modify: apps/server/src/app.ts
- Modify: apps/server/src/routes/transactions.ts only if the online response must expose unreserved remaining credit.
- Modify: apps/server/src/services/transaction.service.ts only if a shared read model is needed; do not duplicate settlement math.
- Create: apps/server/src/services/offline-conflict.service.ts
- Create: apps/server/src/services/offline-conflict.service.test.ts
- Create: apps/server/src/routes/admin-offline.ts

**Interfaces:**

- syncOfflineEvents(merchantId, deviceId, events): AppResult<OfflineSyncResult[]>.
- releaseExpiredOfflineReservations(currentDate): AppResult<{ releasedCount: number;
  releasedCredits: bigint }>.
- listOfflineConflicts(adminId, cursor): AppResult<OfflineConflictSummary[]>.
- getOfflineConflict(adminId, eventId): AppResult<OfflineConflictDetail>.
- closeOfflineConflict(adminId, eventId, reason): AppResult<OfflineConflictReview>.
- Offline sync must call the reservation-aware SQL settlement function. It must not update beneficiaries, merchants, or transactions with separate client-side writes.

The server decision order is:

1. Authenticate the merchant session and resolve the merchant row.
2. Resolve and validate the registered Rural device.
3. Parse the event batch with Zod.
4. Verify sale ID uniqueness, assignment, canonical payload, device signature, permit signature,
   device/merchant binding, server
   receipt-time expiry, permit-pinned policy and catalog versions, item eligibility, and idempotency.
5. Check current emergency revocations. Return conflict and `Needs review` when one applies.
6. Return the original receipt for an identical duplicate.
7. Return conflict for a reused event or transaction ID with different content.
8. Call the atomic reservation-aware settlement function for a valid new event. The function also
   stores the final event decision and sync receipt.
9. Leave rejected events auditable and never make them cash-outable.
10. Store conflict review actions as append-only rows. Never change the original event decision.

- [ ] Step 1: Write tests for seven distinct merchants with separate permits whose combined amounts fit the beneficiary credit.
- [ ] Step 2: Write tests for two concurrent reservation requests whose combined amount exceeds available credit. Exactly one or the policy-approved subset may succeed.
- [ ] Step 3: Write tests that a seventh distinct merchant may receive a permit, an eighth distinct merchant is rejected, and a second device for an existing merchant does not consume another merchant slot.
- [ ] Step 4: Write tests showing an online sale cannot spend active reserved credits.
- [ ] Step 5: Write tests for duplicate event replay, changed duplicate content, invalid
  signature, revoked device, receipt after permit expiry, backdated device timestamp, wrong
  merchant, over-limit amount, ineligible item, permit-pinned routine policy, emergency revocation,
  and invalid catalog version.
- [ ] Step 5A: Write tests for the same sale ID after timeout, late response, app restart, and
  repeated upload. The server must return one original receipt and create one official transaction.
- [ ] Step 5B: Write admin conflict tests for queue, detail evidence, terminal close-rejected,
  immutable original decision, direct-balance-edit rejection, and a separate remediation
  transaction link. Invalid signature, changed replay, wrong merchant, over-limit amount, and
  ineligible product must remain terminal rejections.
- [ ] Step 6: Run pnpm --filter @bantayog/server test and confirm the tests fail before the service and route exist.
- [ ] Step 7: Implement offline-sync.service.ts as orchestration only. Use AppResult and tagged errors for expected failures.
- [ ] Step 8: Add POST /api/offline/sync with merchant authorization and batch size limits. Return one decision per event.
- [ ] Step 9: Add POST /api/cron/offline-release-expired with CRON_SECRET protection and an
  idempotent release operation. Assert that it never increments `credit_balance`.
- [ ] Step 9A: Add authenticated admin list, detail, and close-rejected conflict routes. Do not add
  an endpoint that changes the original event to accepted. Keep any remediation disabled until its
  separate online transaction tests and guardian authorization pass.
- [ ] Step 10: Run pnpm --filter @bantayog/server test, pnpm --filter @bantayog/db test, pnpm type-check, pnpm lint, and pnpm test.
- [ ] Step 11: Verify that no rejected or pending event changes merchants.wallet_balance or cash-out eligibility.

---

### Task 6: Add signed product catalog and offline product validation

**Executor and model:** Freebuff with `DeepSeek V4 Flash 0731`.

**Reasoning effort:** `max` for catalog authority, Gemini removal from eligibility, barcode and OCR
fallback classification, and signed commodity rules.

**First-pass time box:** 75 minutes. Stop if an unknown, ambiguous, or Gemini-only result can become
eligible.

**Files:**
- Create: apps/server/src/services/offline-catalog.service.ts
- Create: apps/server/src/services/offline-catalog.service.test.ts
- Modify: apps/server/src/services/vision.service.ts
- Modify: apps/server/src/services/vision.service.test.ts
- Modify: apps/server/src/services/pricing-validation.service.ts
- Modify: apps/server/src/services/pricing-validation.service.test.ts
- Create: apps/web/lib/offline/catalog.ts
- Create: apps/web/lib/offline/catalog.test.ts
- Create: apps/web/lib/offline/product-validator.ts
- Create: apps/web/lib/offline/product-validator.test.ts
- Modify: packages/schema/src/offline.ts when catalog DTOs are added.
- Create: apps/mobile/android/app/src/main/java/ph/bantayog/merchant/BarcodeScannerPlugin.kt only
  after dependency approval. Both variants must register this shared Branded scanner.
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/OfflineProductPlugin.kt for
  Rural catalog, OCR, image quality, and commodity operations only.

**Interfaces:**

- SignedCatalogRelease: formatVersion, catalogVersion, policyVersion, validFrom, validUntil,
  products, commodities, payloadDigest, keyId, algorithm, signature.
- OfflineCatalogProduct: productId, barcodeValues, canonicalName, aliases, category, eligibility, price limits, validFrom, validUntil.
- OfflineCommodity: commodityId, canonicalName, localAliases, category, eligibility, allowedUnits,
  minimumPriceCentavos, maximumPriceCentavos, validFrom, validUntil.
- validateOfflineProduct(input, catalog, currentDate): ProductValidationResult.
- ProductValidationResult: productId, eligibility, matchMethod, catalogVersion, policyVersion, optional modelVersion, optional imageDigest.

Branded path matrix:

```text
Urban online  -> shared barcode -> server catalog -> Gemini fallback -> server catalog
Rural online  -> shared barcode -> signed local catalog -> Gemini fallback -> signed local catalog
Rural offline -> barcode -> signed local catalog -> OCR alias -> UNKNOWN and block
Urban offline -> transaction unavailable
```

`matchMethod` is `ONLINE_BARCODE`, `ONLINE_GEMINI`, `OFFLINE_BARCODE`, `OFFLINE_OCR`, or
`OFFLINE_MANUAL_COMMODITY`. Gemini, barcode, OCR, and manual text can identify an item. They cannot
set eligibility.

Validation order:

1. Check image quality and crop.
2. Try barcode.
3. Look up the barcode in the signed catalog.
4. Try OCR only when barcode lookup fails.
5. Match approved aliases.
6. Apply catalog eligibility and policy.
7. Return UNKNOWN and block the sale when no approved match exists.

For a non-branded item, the merchant must select an entry from the signed commodity list and enter
the unit, quantity, and integer-centavo price. OCR or an image model may suggest the entry. It may
not authorize it. Unknown commodities, units, or out-of-range prices block the sale.

The software cannot prove physical weight, freshness, delivery, or merchant truth. Store signed
commodity ID, allowed unit, quantity, integer-centavo price, caps, and an optional image digest.
Support policy-selected random audit flags. Do not store the full image.

The WebView may display the result and call the native bridge. The server must recheck catalog and eligibility during synchronization. OpenCV must not decide eligibility. Do not add YOLO or an sLM to the first release.

Remove the current online behavior that uses Gemini `is_child_friendly` as eligibility, creates an
authorized unmatched product, or defaults an unknown category to `VEGETABLES`. Unknown maps to
`OTHER` or `UNKNOWN` and blocks checkout. The online non-branded route must use the signed commodity
policy for eligibility, units, and price bounds. Gemini may compare identity or evidence only.

- [ ] Step 1: Write catalog tests for valid signature, expired release, invalid signature, unknown
  product, eligible product, ineligible product, category OTHER, and non-branded commodity rows.
- [ ] Step 2: Write product-validator tests for barcode hit, OCR alias hit, ambiguous alias, blurry
  image, expired catalog, unknown result, commodity manual selection, unsupported unit,
  out-of-range price, and optional image digest.
- [ ] Step 2A: Write online regression tests that reject Gemini-only eligibility, unmatched product
  authorization, and the `VEGETABLES` default. Test unknown as blocked `OTHER` or `UNKNOWN`.
- [ ] Step 2B: Write path tests for exact barcode success in Urban and Rural online, exact barcode
  success in Rural offline, Gemini fallback in both online variants, and no Urban offline transaction.
- [ ] Step 2C: Write fallback tests for network, DNS, timeout, 408, 429, and 5xx. Test no fallback
  after ineligible, 400 invalid image, 401, 403, invalid signature, or invalid configuration.
- [ ] Step 2D: Write non-branded audit tests for allowed units, price bounds, caps, optional image
  digest, no full image, and deterministic random-audit selection with an injected seed or policy value.
- [ ] Step 3: Run pnpm --filter @bantayog/web test and confirm the new tests fail.
- [ ] Step 4: Implement catalog signature verification and deterministic local lookup.
- [ ] Step 4A: Fix the online Vision and Pricing Validation services so catalog and signed commodity
  policy are the only eligibility authorities. Do not auto-authorize an unknown product.
- [ ] Step 5: Implement product validation as a pure client helper for display. Keep the
  authoritative policy on the server. Implement the shared Branded barcode adapter in the common
  source set and the Rural-only OCR and catalog adapter in the Rural source set.
- [ ] Step 6: Add only approved offline native barcode/OCR/image-quality dependencies. Record the dependency and its low-end benchmark in docs/MOBILE_BUILD.md.
- [ ] Step 7: Run pnpm --filter @bantayog/web test, pnpm --filter @bantayog/server test, pnpm type-check, pnpm lint, and pnpm test.
- [ ] Step 8: Stop if an unknown product or category could reach the offline sale service as eligible.
- [ ] Step 9: Inspect both APKs. Confirm that both contain the shared barcode scanner, only Rural
  contains offline catalog and OCR classes, and no barcode path exists in Non-Branded Scan.

---

### Task 7: Build the Rural native merchant edge and durable local store

**Executor and model:** Antigravity free tier with `Gemini 3.6 Flash`.

**Reasoning effort:** `high`. Sol checkpoints B and C must approve the key, storage, permit, and
trusted-time rules before implementation starts. If Gemini 3.6 Flash is unavailable, use Gemini
3.5 Flash with `high` and record the exact picker label.

**First-pass time box:** 120 minutes after native dependency approval. This time box can produce a
tested slice, but it is not a completion promise for all native and physical-device checks.

**Files:**
- Create or modify: apps/mobile/package.json
- Create or modify: apps/mobile/capacitor.config.ts
- Modify: apps/mobile/android/build.gradle to add the approved Kotlin Android build plugin.
- Modify: apps/mobile/android/app/build.gradle to apply Kotlin and add approved Rural dependencies.
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/MerchantEdgePlugin.kt
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/OfflineDatabase.kt
- Modify: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/DeviceKeyStore.kt
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/OfflineSyncWorker.kt
- Create: apps/mobile/android/app/src/testRural/java/ph/bantayog/merchant/OfflineDatabaseTest.kt
- Create: apps/mobile/android/app/src/androidTestRural/java/ph/bantayog/merchant/OfflineSaleInstrumentedTest.kt
- Create: apps/web/lib/offline/merchant-edge.ts
- Create: apps/web/lib/offline/merchant-edge.test.ts

**Interfaces:**

The WebView adapter must expose only these operations:

- registerDevice(): Promise<DeviceRegistrationRequest>.
- installProvisioningPackage(package): Promise<void>.
- searchAssignedBeneficiaries(query): Promise<MaskedBeneficiarySearchResult[]>.
- verifyOfflinePin(beneficiaryId, pin): Promise<{ verified: boolean; locked: boolean }>.
- unlockOfflineMerchant(input): Promise<{ unlocked: boolean; locked: boolean }>.
- validatePermit(beneficiaryId, merchantId, deviceId, amountCredits): Promise<PermitCheckResult>.
- recordPermitBackedSale(event): Promise<{ saleId: string; eventId: string;
  localStatus: PENDING_SYNC }>.
- listPendingEvents(): Promise<OfflineEvent[]>.
- storeSyncReceipts(receipts): Promise<void>.
- getLocalState(): Promise<{ catalogVersion: string; pendingCount: number; lastServerCursor: string | null }>.
- getEffectiveTrustedTime(): Promise<{ effectiveTime: string; rollbackDetected: boolean;
  forwardJumpDetected: boolean }>.

Use a native transactional store. The local transaction that consumes permit remaining amount and inserts the event must be atomic. A crash before commit must consume neither; a crash after commit must allow the event to sync after restart.

Create the sale ID before final confirmation. Write one signed event before the first network
attempt. Immediate upload, retry, late response, and offline queue must reuse the same sale ID and
event ID. Require an active assignment, valid permit-pinned catalog, valid offline merchant
certificate, permit, and required beneficiary verifier before the local transaction starts.

The preferred database option is encrypted SQLite/SQLCipher. If the owner does not approve the dependency, use Android SQLite with field-level AES-GCM encryption for beneficiary search records, permit material, verifier packages, and event payloads, and document the residual database-at-rest risk.

- [ ] Step 1: Work only in the Rural worktree at
  `/home/yahiro/Documents/PROJECTS/BANTAYOG-worktrees/merchant-apk-rural`. Confirm the existing
  shell at `apps/mobile`, Capacitor version, namespace `ph.bantayog.merchant`, Groovy Gradle files, minSdk
  24, compileSdk 36, targetSdk 36, Android Gradle Plugin 8.13.0, Gradle 8.14.3, JDK 21, and Android
  SDK. Preserve its staged generated files.
- [ ] Step 2: Confirm that Task 3 configured Kotlin and the empty `urban` and `rural` flavors. Stop
  if that dependency gate did not pass.
- [ ] Step 3: Write native unit tests for atomic permit consumption, duplicate event ID,
  insufficient permit, expired permit, and restart recovery.
- [ ] Step 3A: Add native tests for one sale ID across online success, timeout, late response,
  retry, app kill, and offline fallback. Assert one local event and one permit consumption.
- [ ] Step 3B: Add trusted-time tests for seven-day and 72-hour warnings, 24-hour hard stop,
  rollback, large forward jump, restart, and server time refresh.
- [ ] Step 3C: Add local lifecycle tests. Expired or revoked assignments purge directory and PIN
  verifier data. Pending and Needs Review events remain. Accepted and rejected detail follows the
  pilot rule: purge detail 30 calendar days after server receipt or conflict resolution and keep a
  minimum receipt for 90 calendar days. A signed policy can shorten these values. Full images are
  never stored.
- [ ] Step 3D: Add device replacement tests. Revoke the old device and do not export or copy its
  private key. Preserve server audit evidence for any received event.
- [ ] Step 4: Write an instrumentation test that records a Rural sale in airplane mode, kills the
  process, restarts it, and finds one pending event.
- [ ] Step 5: Run the Rural native tests and confirm they fail before the plugin and store exist.
- [ ] Step 6: Add the approved storage implementation and Android Keystore key wrapper under the
  Rural source set. Keep the existing Java shell in `src/main` until Task 9 splits the activities.
- [ ] Step 7: Add the Capacitor plugin methods and the TypeScript adapter. Do not expose raw database queries to the WebView.
- [ ] Step 7A: Add the Keystore-protected native merchant unlock and offline merchant certificate
  checks. Keep the merchant unlock separate from the beneficiary PIN.
- [ ] Step 8: Add WorkManager with a network constraint, exponential retry, event ordering, stop-on-validation-failure behavior, and receipt persistence.
- [ ] Step 8A: Add high-priority sync near the receipt deadline and the local retention worker. Do
  not delete a pending event because its permit expired after the sale; upload it and let the server decide.
- [ ] Step 9: Ensure the worker never treats local pending earnings as accepted merchant balance.
- [ ] Step 10: Run Android unit/instrumentation tests, pnpm --filter @bantayog/web test, pnpm type-check, and pnpm lint.

---

### Task 8: Implement Urban online name search and Rural payment UI

**Executor and model:** Freebuff with `DeepSeek V4 Flash 0731`.

**Reasoning effort:** `high`. Keep the checkout state machine and duplicate-sale tests in the same
task context.

**First-pass time box:** 60 minutes after Tasks 4, 6, and 7. Preserve server authority and the
single-sale-ID contract.

**Files:**
- Create: apps/web/lib/merchant/variant.ts
- Create: apps/web/lib/merchant/variant.test.ts
- Create: apps/web/components/merchant/beneficiary-search.tsx
- Modify: apps/web/app/(merchant)/checkout/page.tsx
- Modify: apps/web/lib/api.ts only for the authenticated search call.
- Modify: apps/web/app/(merchant)/cart/branded/page.tsx and apps/web/app/(merchant)/cart/non-branded/page.tsx only if the shared processing route must pass the selected input source.

**Interfaces:**

- getMerchantVariant(): URBAN or RURAL from a build-time configuration that cannot grant server authority.
- searchOnlineBeneficiaries(query): Promise<MaskedBeneficiarySearchResult[]>.
- searchRuralBeneficiaries(query): Promise<MaskedBeneficiarySearchResult[]> through the native edge adapter.
- authorizePayment(input): online server request for Urban; local PIN, permit, and event creation for Rural.
- authorizeRuralPermitBackedPayment(input): create one sale ID, record one local event, attempt
  immediate sync when online, or leave the same event pending when allowed fallback occurs.

The shared UI flow remains:

Dashboard → Branded or Non-Branded scan → Processing → beneficiary/payment selection → PIN → confirmation.

Payment branch:

- Urban with card: QR scan → server verification → PIN → current online transaction.
- Urban without card: online name search → masked selection → PIN → current online transaction.
- Rural with card: signed QR verification → local PIN and permit checks → local event when offline.
- Rural without card: local name search → local PIN and permit checks → local event when offline.

For Rural, `navigator.onLine` is a display hint only. Attempt the request with a bounded timeout.
Use the local event path for network, DNS, timeout, 408, 429, or 5xx. Show recapture for 400, require
online login for 401 or 403, and block on ineligible, invalid signature, or invalid configuration.
Do not create a second sale after a timeout.

Do not put eligibility, reservation amount, balance, or settlement decisions in React components. Do not use the existing merchant app lock PIN as the beneficiary PIN. Do not show a local pending amount as official wallet balance.

- [ ] Step 1: Write pure variant tests for Urban and Rural builds, missing variant, and invalid variant.
- [ ] Step 2: Write the online search client test for masked results, no balance fields, and network failure.
- [ ] Step 3: Write the Rural edge adapter test for local search, local PIN lockout, missing permit, and pending event result.
- [ ] Step 3A: Write UI fallback tests for network, DNS, timeout, 408, 429, 5xx, late success, and
  retry. Test no fallback for ineligible, 400, 401, 403, invalid signature, and invalid configuration.
- [ ] Step 3B: Write prerequisite tests for assignment, catalog, merchant certificate, permit, and
  beneficiary verifier. If one is missing, show `Offline unavailable` and create no sale.
- [ ] Step 4: Run pnpm --filter @bantayog/web test and confirm the new tests fail.
- [ ] Step 5: Implement the beneficiary-search component with duplicate-name disambiguation and large-tap controls.
- [ ] Step 6: Integrate the two payment options into checkout without changing the server transaction contract until the server route supports the selected identity flow.
- [ ] Step 7: Add Rural offline status copy: Pending sync, Accepted, Needs review, and Offline unavailable. Never label a local pending sale as completed official settlement.
- [ ] Step 7A: Add expiry warnings at seven days and 72 hours and the 24-hour hard-stop message.
  Add separate copy for merchant unlock and beneficiary PIN. Never call them the same PIN.
- [ ] Step 8: Run pnpm --filter @bantayog/web test, pnpm type-check, pnpm lint, and pnpm test.
- [ ] Step 9: Review the flow on a 720p low-end device and confirm that search, PIN, and confirmation remain usable one-handed.

---

### Task 9: Create the variants and build both final APKs

**Executor and model:** Antigravity free tier with `Gemini 3.6 Flash`.

**Reasoning effort:** `high` for source-set separation, integration revision, artifact inspection,
and stale-install detection. Release signing still needs separate owner approval. If Gemini 3.6
Flash is unavailable, use Gemini 3.5 Flash with `high` and record the exact picker label.

**First-pass time box:** 90 minutes after Tasks 0 through 8 pass and signing approval is available.
Gradle downloads, physical installation, and signing-key custody can extend elapsed time.

**Files:**
- Modify: apps/mobile/android/app/build.gradle
- Create or modify: apps/mobile/android/app/src/urban/AndroidManifest.xml
- Create or modify: apps/mobile/android/app/src/rural/AndroidManifest.xml
- Move: apps/mobile/android/app/src/main/java/ph/bantayog/merchant/MainActivity.java to
  apps/mobile/android/app/src/urban/java/ph/bantayog/merchant/MainActivity.java
- Create: apps/mobile/android/app/src/rural/java/ph/bantayog/merchant/MainActivity.java
- Modify: apps/web/next.config.ts
- Create or modify: apps/web/scripts/build-mobile.mjs
- Modify: apps/web/package.json
- Modify: turbo.json if variant environment variables are added.
- Create: docs/MOBILE_BUILD.md
- Modify: `.gitignore` to exclude local signing properties and all APK, AAB, and keystore files.
- Create locally, never commit: `apps/mobile/android/keystore.properties` or equivalent secure
  environment-backed signing configuration.

**Interfaces:**

- Gradle flavor dimension: `connectivity`.
- Product flavors: `urban` and `rural`.
- Urban application ID: `ph.bantayog.merchant`.
- Rural application ID: `ph.bantayog.merchant.rural` through `applicationIdSuffix ".rural"`.
- Build metadata must include variant, API base, catalog policy version, and source revision.
- Both artifacts must contain and register the shared Branded `BarcodeScannerPlugin` from
  `src/main`. Barcode scanning must remain unavailable in Non-Branded Scan.
- Urban artifact must not contain Rural Kotlin classes, native plugin registration, offline
  database schema, verifier packages, or Rural-only routes.
- Rural artifact must contain the offline edge plugin and start with a valid last-known-good local package.
- Final Urban output: `apps/mobile/android/app/build/outputs/apk/urban/release/app-urban-release.apk`.
- Final Rural output: `apps/mobile/android/app/build/outputs/apk/rural/release/app-rural-release.apk`.
- Urban release package: `ph.bantayog.merchant`.
- Rural release package: `ph.bantayog.merchant.rural`.
- Use a separate release signing identity for each application ID. Store each keystore outside the
  repository, back it up securely, and never print its path password, key password, or private key.
- Both final APKs must contain the same source revision, release version, API base, shared barcode
  implementation, catalog contract, and security policy metadata.

Use the existing merchant-only static export boundary. Build separate Urban and Rural web exports
with a validated `MERCHANT_VARIANT` value. Copy each export only to its matching Android flavor
asset source set. The APK must start at `https://localhost/merchant-login` and use an absolute
HTTPS API base in release builds. Do not use `server.url` or a local API in a release artifact.

- [ ] Step 1: Add build metadata tests for urban and rural variants, missing API base, non-HTTPS API base, and accidental local host.
- [ ] Step 2: Add static export listing tests for Urban exclusion of Rural-only assets and Rural inclusion of the offline bridge entry point.
- [ ] Step 2A: Add Android source-set and artifact tests that require the shared barcode scanner in
  both variants and reject Rural catalog, OCR, storage, verifier, trusted-time, and sync classes in Urban.
- [ ] Step 3: Run the export tests and confirm they fail before the build variant configuration exists.
- [ ] Step 4: Complete the existing empty `urban` and `rural` flavors with the application IDs,
  labels, and asset source sets. Move the existing Java `MainActivity` into the Urban source set.
  Add a Rural `MainActivity` that registers only the Rural plugins.
- [ ] Step 5: Configure `build-mobile.mjs` to reject a missing or invalid `MERCHANT_VARIANT`,
  create separate Urban and Rural exports, and copy each export to its matching flavor assets.
  Keep business logic on the server.
- [ ] Step 6: Build `assembleUrbanDebug` and `assembleRuralDebug` with JDK 21. Verify the start
  URL, marker, variant, API base, application ID, and APK contents. Build Urban debug in
  `/home/yahiro/Documents/PROJECTS/BANTAYOG-worktrees/merchant-apk`. Build Rural debug in
  `/home/yahiro/Documents/PROJECTS/BANTAYOG-worktrees/merchant-apk-rural`.
- [ ] Step 6A: On each installed APK, scan one exact Branded barcode while online. On Rural, repeat
  in airplane mode. Confirm that Non-Branded Scan does not start the barcode path.
- [ ] Step 7: Run the Android smoke checks and document the exact commands, environment, and known limitations in docs/MOBILE_BUILD.md.
- [ ] Step 8: Run pnpm --filter @bantayog/web build, pnpm --filter @bantayog/web test, pnpm type-check, and pnpm lint.
- [ ] Step 9: Stop if Urban contains Rural storage or if Rural can start without a valid signed provisioning package.
- [ ] Step 10: Stop for owner approval of the final integration method. Apply the reviewed Urban,
  Rural, shared server, schema, web, and Android changes to one clean integration revision. Do not
  merge, commit, or rewrite either branch without explicit owner instruction.
- [ ] Step 11: From that clean integration revision, run the full lint, type-check, tests, both
  mobile exports, Capacitor sync, Android unit tests, and both debug builds. Record the immutable
  source revision. Stop on any failure.
- [ ] Step 12: Stop for owner approval of two release signing identities and their backup custody.
  Configure signing through a git-ignored properties file or secure environment variables. Never
  store a signing file or password in Git, Gradle source, Capacitor configuration, logs, or docs.
- [ ] Step 13: Build the two signed release APKs from the same integration revision with JDK 21:

```bash
./gradlew assembleUrbanRelease assembleRuralRelease
```

- [ ] Step 14: Verify each final artifact before installation. Record non-zero size, modification
  time, ZIP integrity, application ID, version code, version name, minimum SDK, target SDK, signer
  certificate SHA-256, file SHA-256, embedded variant, API base, and source revision. Use the local
  Android SDK tools and commands equivalent to:

```bash
stat -c '%s %y %n' <apk>
unzip -t <apk>
aapt dump badging <apk>
apksigner verify --verbose --print-certs <apk>
sha256sum <apk>
```

- [ ] Step 15: Install both signed APKs side by side on the approved physical phone. Verify that
  Android reports `ph.bantayog.merchant` for Urban and `ph.bantayog.merchant.rural` for Rural.
  Confirm that the install time and update time match the new artifacts, not a stale app.
- [ ] Step 16: Run final artifact behavior checks: online Branded barcode in both APKs, Gemini
  fallback in both APKs, no barcode mode in Non-Branded Scan, no Rural classes or data in Urban,
  Rural airplane-mode barcode and OCR, Rural offline sale and restart recovery, sync to one
  official transaction, and online-only cash-out.
- [ ] Step 17: Write an artifact manifest in `docs/MOBILE_BUILD.md` with both output paths,
  application IDs, source revision, versions, signer certificate fingerprints, APK SHA-256 values,
  device model, Android version, install evidence, transaction ID, and server audit receipt.
- [ ] Step 18: Do not call either file a final APK if it is unsigned, zero bytes, malformed, built
  from different integration content, missing its expected feature boundary, uninstalled, or
  missing the required physical transaction and audit evidence.

---

### Task 10: End-to-end security, seven-merchant, and physical acceptance

**Executor and model:** Freebuff with `DeepSeek V4 Flash 0731`.

**Reasoning effort:** `max` for final failure analysis and evidence reconciliation. Use `high` only
for mechanical reruns after the failure cause is known. Enforce all findings from Sol checkpoints
A, B, and C. Do not open a new Sol session by default.

**First-pass time box:** 120 minutes after both signed APKs exist. Do not claim completion without
the physical transaction ID, stored server audit receipt, and all critical scenario results.

**Files:**
- Modify or create: apps/server/src/e2e/offline-multi-merchant-flow.test.ts
- Modify or create: apps/server/src/e2e/offline-sync-flow.test.ts
- Modify or create: apps/web/e2e/offline-merchant-flow.spec.ts
- Modify: docs/MOBILE_BUILD.md
- Modify: docs/context/PRD.md, docs/context/ARCHITECTURE.md, docs/context/SCHEMA.md, docs/SECURITY.md, and .kiro/steering files only to record verified behavior, not future claims.

**Scenario data:**

- Beneficiary balance: 1,000 credits.
- Rural M1 permit: 300 credits; M2 permit: 200 credits; M3, M4, and M5 permits: 100 credits each;
  M6 and M7 permits: 50 credits each. The seven permits total 900 credits and leave 100 credits
  unreserved.
- M1 offline sale: 250 credits; M2 offline sale: 150 credits; M3 and M4 offline sales: 75 credits
  each; M5 offline sale: 50 credits; M6 and M7 offline sales: 25 credits each.
- Online attempted sale: 101 credits before any offline sync.
- Rural M8 permit request: 50 credits, rejected because M1 through M7 already hold the maximum
  number of distinct merchant slots.
- A second device for M1 requests a refresh and must remain within M1's existing merchant allocation.
- Replayed Store A event: same event ID and same payload.
- Conflicting replay: same event ID and changed amount.
- Expired and revoked permits.
- Permit issue time: day 0. Sale cutoff: day 29. Server expiry: day 30.
- One event with a device timestamp before expiry but a server receipt on day 31.
- One routine catalog update after permit issue and one emergency product revocation.
- One non-branded commodity sale with a signed commodity ID and one unknown commodity attempt.
- Seven administrator-approved beneficiary-merchant assignments and one unassigned M8 request.
- One exact Branded barcode, one unknown barcode with Gemini online fallback, one OCR alias, and
  one Gemini result that claims an unknown item is child-friendly.
- Network, DNS, timeout, 408, 429, 500, ineligible, 400, 401, 403, invalid signature, and invalid
  configuration responses.
- One sale ID with a timeout, late server response, app restart, and retry.
- One QR version 2 pass for each active key-overlap state and one revoked pass.
- One invalid catalog release, one interrupted catalog install, and one last-known-good release.
- One valid offline merchant certificate, one expired certificate, and one certificate used on a
  forbidden sync or cash-out route.
- One conflict close-rejected review and one attempted direct decision or balance edit.
- One assignment revocation, one device replacement, and one unsynchronized destroyed-device
  scenario recorded as residual operational loss.

**Expected results:**

- Reservation issuance creates seven permits, leaves 100 credits unreserved, and counts seven
  distinct merchant IDs.
- Only the seven approved assignments can search, provision, create verifiers, or reserve credit.
  M8 cannot self-assign or reserve by knowing the beneficiary identifier, pass, or PIN.
- The online 101-credit sale is rejected while the seven permits are active.
- M1 through M7 can record their permitted offline sales independently.
- M8 cannot receive a new active permit, and M1's second device does not create an eighth merchant
  slot.
- Sync accepts each valid event once.
- Replayed identical events return the original receipt.
- Changed replay returns conflict and does not move money.
- Expired or over-limit permits reject without changing official balance.
- The day-31 event is rejected even when its device timestamp claims day 29.
- Expiry and release do not increment `credit_balance`.
- A routine update uses the permit-pinned catalog and policy versions. An emergency revocation
  creates `Needs review` and does not change cash-outable balance.
- The signed non-branded commodity can pass its deterministic unit and price checks. The unknown
  commodity is blocked offline.
- Both APKs accept the exact Branded barcode while online. Rural accepts it offline. Gemini is used
  online only after barcode identification fails, and its eligibility claim cannot override the catalog.
- Rural falls back only for network, DNS, timeout, 408, 429, and 5xx. It does not fall back for an
  ineligible result, 400, 401, 403, invalid signature, or invalid configuration.
- The timed-out and retried sale creates one local event, one official transaction, and one receipt.
- QR version 2 uses ES256, has a minimal payload, checks revocation on every pass route, and has no
  HMAC fallback. QR, permit, and catalog key rotations remain independent.
- An invalid or interrupted catalog install keeps the last-known-good release.
- The offline merchant certificate authorizes local actions only. It cannot authorize sync,
  provisioning, release, administration, or cash-out.
- The conflict review is append-only. Closing it does not move money or change the original decision.
- Revocation purges assigned private data but preserves pending audit records. Device replacement
  creates a new private key and never copies the old key.
- Official balance decreases by 650 after the seven valid events are accepted.
- Official merchant balances increase by 250, 150, 75, 75, 50, 25, and 25 credits.
- The remaining active reservation amount is 250 credits and the unreserved amount remains 100
  credits until release or further use.
- No local pending event is cash-outable before acknowledgement.
- A real server transaction ID and audit receipt exist after synchronization.
- Each accepted event, official transaction, balance movement, final decision, and receipt are in
  the same committed database transaction.

- [ ] Step 1: Add server integration tests with a fake signed catalog, registered devices, separate permits, concurrent requests, and an injected current date.
- [ ] Step 2: Add browser tests for Urban online name search and Rural offline branch using a local fixture server. Do not call the deployed API.
- [ ] Step 2A: Add browser and server tests for the complete product and fallback matrix. Include
  exact barcode in both variants, Gemini fallback, catalog authority, all fallback response classes,
  and one sale ID across timeout and retry.
- [ ] Step 2B: Add security tests for assignment authorization, QR version 2 and revocation,
  separate key rotation, catalog release/install, offline merchant certificate capabilities,
  append-only conflict review, retention, and device replacement.
- [ ] Step 3: Run the full package tests, lint, type-check, and build. Record every command and result.
- [ ] Step 4: Use the two signed release APKs from Task 9 for emulator and physical smoke tests in
  online, airplane, app-kill, restart, low-battery, clock-drift, full-storage, and
  intermittent-network conditions. Do not substitute a stale debug installation.
- [ ] Step 4A: Run the exact APK artifacts on a representative low-end physical Android phone with
  a 720p camera. Record cold start, one-frame barcode, OCR fallback, memory use, scan duration,
  timeout behavior, one-model-at-a-time behavior, and manual retry.
- [ ] Step 5: Run the seven-merchant scenario with seven isolated merchant data stores. Confirm that no shared local balance is used and that the eighth merchant request is rejected.
- [ ] Step 6: Run the 30-day receipt-time boundary, aggregate multi-device merchant cap, policy
  version, emergency revocation, no-card lockout, and non-branded commodity scenarios.
- [ ] Step 6A: Run seven-day and 72-hour warnings, 24-hour hard stop, clock rollback, large forward
  jump, high-priority deadline sync, local purge, retention, and device replacement scenarios.
- [ ] Step 6B: Verify demo cost controls: no payout provider, no mainnet, no paid automatic upgrade,
  current free-tier model check, Gemini usage limit and alert, product-only crop with no PII, and
  deterministic Rural behavior when Gemini quota is unavailable.
- [ ] Step 7: Run one authorized physical-device test only after the owner approves the test data
  and environment. Store the official transaction ID and audit evidence. Do not use real funds or
  a mainnet.
- [ ] Step 8: Review logs and both APK contents for PINs, private keys, QR signing secrets, full
  balances, PII leakage, stack traces, and Rural classes inside the Urban artifact.
- [ ] Step 9: Update documentation to separate implemented behavior from unverified physical behavior.
- [ ] Step 10: Stop and report any rejected sync event, missing transaction ID, missing audit row,
  atomicity mismatch, or cash-out state mismatch. Do not claim completion.

## Final handoff checklist

- [ ] ADR-004 and the revised design are approved by the owner.
- [ ] All migration, settle_sale, authentication, RLS, QR signing, and native dependency gates are explicitly approved.
- [ ] Shared Zod contracts, DB types, migration, and tests agree.
- [ ] Multi-merchant reservation invariant passes under concurrency for seven distinct merchants.
- [ ] Only administrator-approved assignments can search, provision, create verifiers, or reserve;
  an eighth active distinct Rural merchant assignment is rejected.
- [ ] Multiple devices for one merchant stay inside one aggregate merchant policy cap.
- [ ] The 30-day permit, 24-hour sale cutoff, server receipt-time expiry, and device-clock
  backdating tests pass.
- [ ] Seven-day and 72-hour warnings, non-decreasing trusted time, clock rollback, large forward
  jump, and high-priority deadline sync tests pass.
- [ ] Expiry and release never increment `credit_balance`.
- [ ] Accepted settlement and its event decision and sync receipt commit atomically.
- [ ] Routine updates use permit-pinned versions, and emergency revocations create `Needs review`.
- [ ] Offline no-card payment locks after five failures until online re-provisioning and fails
  closed without signed amount and event-count limits.
- [ ] Signed non-branded commodity selection, unit, quantity, and price checks pass offline.
- [ ] Non-branded caps, optional image digest, no-full-image rule, and random audit flag pass. The
  handoff records that software does not prove physical weight, freshness, delivery, or truth.
- [ ] Both APKs scan Branded barcodes online; Rural scans them offline; Non-Branded Scan does not
  use the barcode path; Gemini remains the online fallback only.
- [ ] Catalog eligibility overrides Gemini, barcode, OCR, and manual identification. Unknown never
  defaults to `VEGETABLES` or becomes eligible.
- [ ] Rural fallback occurs only for network, DNS, timeout, 408, 429, or 5xx and requires all local
  prerequisites. Security, auth, image, configuration, and policy failures do not fall back.
- [ ] One sale ID produces one local event and one official transaction across timeout, late
  response, retry, restart, and offline queue.
- [ ] QR pass version 2 uses ES256, a minimal payload, no HMAC fallback, and expiry plus revocation
  checks on every pass route. QR, permit, and catalog keys rotate independently.
- [ ] Catalog creation validates all fields, stores an immutable signed payload, installs
  atomically, and preserves the last-known-good release after failure.
- [ ] Offline merchant certificates authorize local actions only. Native merchant unlock is
  separate from the beneficiary PIN. Fresh online auth protects sync and all sensitive operations.
- [ ] Reservation manual release records actor and reason and never adds beneficiary credit.
- [ ] Conflict review is append-only. Terminal rejection moves no money. Any remediation is a
  separate current-policy online transaction and leaves the original event unchanged.
- [ ] Assignment and device revocation purge local directory and PIN verifier data without deleting
  pending evidence. Device replacement never copies a private key.
- [ ] Local detailed accepted or rejected data expires after 30 calendar days and the minimum
  receipt after 90 calendar days. A longer signed policy is rejected without a privacy review.
- [ ] Urban online name search and PIN flow pass.
- [ ] Rural local search, PIN, product validation, permit consumption, restart recovery, and sync pass.
- [ ] Urban and Rural APK artifacts are separate and contain only their permitted capabilities.
- [ ] Urban development used `/home/yahiro/Documents/PROJECTS/BANTAYOG-worktrees/merchant-apk`.
  Rural development used `/home/yahiro/Documents/PROJECTS/BANTAYOG-worktrees/merchant-apk-rural`.
  Both final artifacts came from one clean approved integration revision.
- [ ] `app-urban-release.apk` is signed, non-zero, valid, installable, and identifies itself as
  `ph.bantayog.merchant`.
- [ ] `app-rural-release.apk` is signed, non-zero, valid, installable, and identifies itself as
  `ph.bantayog.merchant.rural`.
- [ ] Both artifact manifests record source revision, version, signer fingerprint, APK SHA-256,
  physical installation evidence, official transaction ID, and server audit receipt.
- [ ] The seven-merchant cap and eighth-merchant rejection pass under concurrency.
- [ ] Server-accepted events alone affect official merchant cash-out balance.
- [ ] No GCash, GoTyme, or bank-account payout code, credentials, provider API call, or payout UI
  exists; the future partnership plan is documented only.
- [ ] Full lint, type-check, tests, builds, and device evidence are recorded.
- [ ] The representative low-end 720p physical-device benchmark and exact APK artifact scans are recorded.
- [ ] Demo operation uses no mandatory new paid provider, no real payout integration, no mainnet,
  and no paid automatic upgrade. Gemini quota loss follows the permitted deterministic fallback.
- [ ] No commit, push, deployment, or real Supabase migration was performed without owner instruction.

## Reference Guides for the Executor

- [OpenAI model selection](https://developers.openai.com/api/docs/models)
- [OpenAI GPT-5.6 model and reasoning guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [Google Antigravity model availability and reasoning levels](https://antigravity.google/docs/models)
- [Google Antigravity free-tier quota rules](https://antigravity.google/docs/plans)
- [DeepSeek V4 Flash reasoning effort controls](https://api-docs.deepseek.com/api/create-chat-completion)
- [BIS Project Polaris: high-level design guide for offline payments](https://www.bis.org/publ/othp79.htm)
- [BIS Project Polaris: handbook for offline payments with CBDC](https://www.bis.org/publ/othp64.htm)
- [Android offline-first application guidance](https://developer.android.com/topic/architecture/data-layer/offline-first)
- [Android Keystore system](https://developer.android.com/privacy-and-security/keystore)
- [Android WorkManager](https://developer.android.com/reference/androidx/work/WorkManager)
- [ML Kit barcode scanning for Android](https://developers.google.com/ml-kit/vision/barcode-scanning/android)
- [ML Kit text recognition for Android](https://developers.google.com/ml-kit/vision/text-recognition/v2/android)
- [SQLCipher Community Edition license](https://www.zetetic.net/sqlcipher/license/)
- [OpenCV license](https://opencv.org/license/)
- [Gemini Developer API pricing and free-tier data terms](https://ai.google.dev/gemini-api/docs/pricing)
