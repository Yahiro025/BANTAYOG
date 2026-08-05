# PRD — BANTAYOG

Written in ASD-STE100 Simplified Technical English. Keep the sentences short and active.

This file holds the scope, the MVP, the goals, the technical requirements and the success
metrics. It does not hold event facts (see `docs/SHOWCASE.md`), design tokens (see
`DESIGN.md`), architecture (see `ARCHITECTURE.md`) or schema (see `SCHEMA.md`).

## 1. Problem

One in four Filipino children below five years old has stunted growth. The cause is chronic
malnutrition in the first 1,000 days of life. LGUs give nutrition assistance as cash. Cash has
three failures:

1. Guardians can spend the cash on non-nutritious items. The LGU cannot see the spend.
2. The LGU gets no item-level record. Audit is manual and late.
3. Sari-sari store merchants avoid subsidy programs. Reimbursement is slow and complex.

## 2. Product statement

BANTAYOG converts an LGU nutrition cash grant into a nutrition-locked subsidy. The guardian gets
a printed QR "Nutri-Pass". The pass holds credits. The merchant can spend the credits only on
child-appropriate food. The system records each sale off-chain first, then settles it on Stellar
Testnet testnet with a mock PHPC token.

## 3. Goals

| ID | Goal | Measure |
| --- | --- | --- |
| G1 | Lock subsidy spend to child-appropriate food | Eligibility comes from the `products` catalog only (ADR-003) |
| G2 | Give the LGU an item-level audit trail | Every sale writes `transactions.item_list_jsonb` |
| G3 | Keep the merchant experience instant | Checkout returns after the `settle_sale` RPC, not after a chain receipt (ADR-001) |
| G4 | Keep the guardian interface offline-tolerant | The pass is printed paper. The PWA serves a `/~offline` fallback |
| G5 | Keep policy decisions server-side | Tier, eligibility, balance and settlement run in `apps/server` only |

### Non-goals

- No beneficiary mobile app and no beneficiary login. The printed pass is the only interface.
- No cash withdrawal for guardians. Credits are not convertible to cash.
- No mainnet deployment and no real money. Stellar Testnet testnet only.
- No nutrition advice, no medical claims and no diagnosis.
- No new features for a demo. Present the built system (see `docs/SHOWCASE.md`).

## 4. Users

| User | Surface | Authentication |
| --- | --- | --- |
| LGU administrator | `/login`, `/admin/*` | Supabase email and password, `app_metadata.role === 'admin'` |
| Sari-sari merchant | `/merchant-login`, `/dashboard`, `/cart/*`, `/checkout/*` | Supabase password on `<mobile>@merchant.bantayog.local`, or an EVM `sign` proof |
| Guardian | `/balance` | None. The signed QR token is the credential |

The guardian has low literacy and a low-end Android device. Keep the taps large and the steps
few. Use Tagalog-friendly copy.

## 5. Scope

### In scope (built)

1. **Beneficiary registration.** Guardian and child data, monthly income, GPS point, 6-digit
   guardian PIN (Argon2id), card serial. The server generates a custodial EVM wallet for each
   beneficiary and stores the private key as AES-256-GCM ciphertext only.
2. **Tier computation.** Tier 1 (Critical) applies while the age from conception is 1,000 days or
   less. This equals 730 days or less from birth. Tier 2 (Standard) applies after that. The server
   computes the tier on read, at scan time and in a nightly cron job (ADR-002).
3. **One-time allocation.** Tier 1 gets 5,000 PHPC. Tier 2 gets 3,500 PHPC. The
   `allocations.beneficiary_id` UNIQUE constraint stops a second allocation.
4. **QR pass issue.** The server signs a JWS (HS256) payload and writes a `qr_passes` row.
5. **Product scan.** The merchant photographs a product. Gemini returns `blurry`,
   `unrecognized` or `identified`, a child-safety verdict, a category and a researched PHP base
   price. The catalog decides eligibility, not the model (ADR-003).
6. **Cart and checkout.** The server verifies the QR token, checks `qr_passes.expires_at`,
   verifies the guardian PIN with a lockout, rejects a non-positive total, rejects a total above
   the balance, then calls the `settle_sale` RPC.
7. **Merchant cash-out.** The merchant connects an EVM wallet with a `sign` proof. The
   server takes the `cashout_in_progress` lock, transfers PHPC on-chain, waits for the receipt,
   then zeroes the off-chain balance.
8. **Public balance view.** The printed pass opens a read-only page. The page shows the balance
   and up to 50 transactions, newest first.
9. **Chain settlement.** The `outbox` table plus `POST /api/cron/reconcile` transfer PHPC to the
   merchant wallet. The worker is built and tested. The live checkout route does not write an
   outbox row today, so a real sale does not reach the chain without a manual enqueue. See
   section 9.

### Out of scope (this release)

- Multi-LGU tenancy and per-LGU budget ceilings.
- Merchant self-registration. An administrator registers and approves each merchant.
- Product catalog moderation UI for draft rows that the scan flow creates.
- Push notifications and SMS.
- Real DA or PSA price feeds. `market_prices` holds seeded reference rows.

## 6. MVP definition

The MVP is complete when one operator can run this path end to end on Stellar Testnet:

1. The administrator registers a beneficiary and issues a printed pass.
2. The administrator triggers the one-time allocation for that beneficiary.
3. The merchant scans two products. One product is eligible. One product is not eligible.
4. The merchant completes checkout with the guardian PIN. The response arrives in under 2 seconds.
5. The guardian scans the pass and sees the new balance and the new transaction.
6. The reconcile cron records the sale on Testnet and marks the outbox row `DONE`.

Step 6 does not run from a live checkout today. The checkout route writes no outbox row, so the
queue stays empty. Closing this gap needs one insert in the checkout path. See section 9, item 8.

## 7. Technical requirements

### Functional

| ID | Requirement |
| --- | --- |
| FR1 | The server computes the intervention tier. The server never reads a tier from the request body |
| FR2 | The allocation amount comes from the computed tier. Tier 1 = 5,000. Tier 2 = 3,500 |
| FR3 | Eligibility comes from a `products` row. A Gemini verdict alone never authorises a sale |
| FR4 | Checkout verifies the QR token, then `expires_at`, then the beneficiary status, then the PIN, then the total, then the balance. The order is fixed |
| FR5 | Money moves only through the `settle_sale` RPC |
| FR6 | `POST /api/transactions` needs an `idempotencyKey` UUID. The key is also the transaction id |
| FR7 | Cash-out needs a connected wallet and a positive balance. The server zeroes the balance only after the chain receipt |
| FR8 | `GET /api/balance/view` is public, read-only and needs a valid signed token |
| FR9 | The reconcile cron retries a failed chain submit up to 3 attempts, then marks the row `FAILED` and writes a `BALANCE_RESTORATION_AUDIT` outbox row |

### Non-functional

| ID | Requirement | Current control |
| --- | --- | --- |
| NFR1 | Money stays exact | PHP with 2 decimals, `NUMERIC(12,2)`, integer credits, 1 credit = 1e18 wei. No floats |
| NFR2 | Expected failures are values | Services return `AppResult<T>` from `neverthrow`. Routes map the error with `errorToHttpStatus` |
| NFR3 | Inputs are parsed at the boundary | `zValidator` plus Zod schemas from `@bantayog/schema` |
| NFR4 | Brute force is bounded | Upstash sliding windows: login 5/60s, merchant-login 5/60s, verify-pin 3/60s, Gemini 10/60s, global 100/60s. PIN lockout after 5 failures for 900s |
| NFR5 | Secrets never leak | pino key redaction plus `redactSecrets` value redaction. No PIN, key, PII or stack trace in a response |
| NFR6 | Concurrency is safe | `SELECT ... FOR UPDATE` in `settle_sale`. Conditional update for `cashout_in_progress`. UNIQUE on `idempotency_key` and `allocations.beneficiary_id` |
| NFR7 | The chain target is fixed | Stellar Testnet, chain id Testnet, through `loadChainConfig` only |
| NFR8 | The web app holds no business logic | `apps/web` calls `/api/*`. The proxy route only forwards |
| NFR9 | The build gate is clean | `pnpm lint` with `--max-warnings 0`, `pnpm type-check`, `pnpm test` |

## 8. Success metrics

### Engineering metrics (measurable now)

| Metric | Target |
| --- | --- |
| `pnpm lint` warnings | 0 |
| `pnpm type-check` errors | 0 |
| `pnpm test` failures | 0 |
| Checkout response time, off-chain path | under 2 s at the 95th percentile |
| Balance view response time | under 1 s at the 95th percentile |
| Outbox rows in `FAILED` after 3 attempts | 0 per demo run |
| Double allocation for one beneficiary | 0 (UNIQUE constraint) |
| Double spend for one `idempotencyKey` | 0 (UNIQUE constraint) |

### Programme metrics (targets, not measured)

These numbers need an LGU pilot. Do not present them as results.

| Metric | Target |
| --- | --- |
| Share of subsidy spend on catalog-eligible items | 100 % by construction |
| Time from sale to LGU audit record | under 1 minute |
| Merchant time to complete one checkout | under 60 s |
| Guardian steps to read the balance | 1 scan |

## 9. Known gaps

Read these before you answer a judge question or file a bug.

1. `qr_passes.revoked` is checked by `POST /api/auth/verify-qr` only. Checkout and the balance view
   check `expires_at` only. A revoked pass can still transact.
2. `QrTokenService.getSecretKey()` falls back to a hardcoded literal. Always set
   `QR_TOKEN_SECRET`.
3. QR tokens carry no `exp`. `QR_TOKEN_TTL_SECONDS` is validated but unused.
4. `docs/SECURITY.md` states that the system never stores scanned images. The `analyzeScan` path
   stores a base64 data URL in `products.image_url`.
5. `/api/vision/analyze-scan` and `/api/vision/validate-non-branded` carry the global limit only.
   They are the heavier Gemini callers.
6. The reconcile cron sends a plain treasury-to-merchant PHPC transfer. It does not call
   `processTransaction` on `StellarContract`.
7. `packages/db/src/types.ts` lags the migrations. See the drift table in `SCHEMA.md`.
8. The live checkout route writes no `outbox` row. `TransactionService.createTransaction` writes
   one, but no route calls that method. The reconcile cron therefore has an empty queue after a
   real sale. The chain leg runs today only through merchant cash-out.
9. The checkout response reports `totalCreditDeducted`, `idempotencyKey`, `confirmedAt` and
   `stablecoinAmountWei`, but `settle_sale` does not persist those columns. The response and the
   stored row differ.
