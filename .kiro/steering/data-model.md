---
inclusion: manual
---

# Data Model (Supabase Postgres)

Migrations are numbered and additive in `supabase/migrations/`. The current schema is the sum of
all of them — migration 00001 alone is out of date. Mirror every schema change in
`packages/db/src/types.ts`.

| Migration | Adds |
| --- | --- |
| 00001 | `beneficiaries`, `merchants`, `transactions`, `products`, `qr_passes`, `has_role()`, RLS, `cart-photos` + `qr-passes` storage buckets |
| 00002 | `beneficiaries.intervention_tier`; transaction credit/chain columns; new status CHECK; `outbox` table |
| 00003 | `beneficiary_wallets`, `allocations` |
| 00004 | `merchants.wallet_balance`, nullable `wallet_address`, `cashout_in_progress`, `settle_sale()` RPC |
| 00005 | pgvector, `products.reference_image_url` + `image_embedding vector(768)`, HNSW index, `match_product_embeddings()`, `reference-images` bucket |
| 00006 | duplicate pgvector/embedding setup (overlaps 00005 — treat as historical noise) |
| 00007 | `match_product_embeddings` RPC refinement |
| 00008 | `products.image_url`; category consolidation to `FRUITS, VEGETABLES, MEATS, BEVERAGES, DAIRY, GRAINS, CANNED_GOODS, SNACKS, OTHER` |
| 00009 | `qr_passes.expires_at` nullable (passes can be non-expiring) |
| 00010 | pg_trgm + `market_prices` (commodity/local name, unit, min/max, source, `as_of_date`, trigram GIN indexes) |

## Tables

- **beneficiaries** — guardian name + hashed mobile, `child_name`, `child_age_months` (0–120),
  `monthly_income_php`, GPS lat/lng with range CHECKs, `pin_hash_argon2id` + `pin_salt`,
  `eligibility_status ∈ {PENDING, ELIGIBLE, INELIGIBLE, SUSPENDED}`, `credit_balance NUMERIC(12,2) >= 0`,
  unique `card_serial`, `intervention_tier ∈ {1,2}`, activation timestamps.
- **beneficiary_wallets** — PK = `beneficiary_id` (1:1), unique `address` with a
  `^0x[0-9a-fA-F]{40}$` CHECK, and `enc_ciphertext` / `enc_iv` / `enc_auth_tag` from AES-256-GCM.
  Plaintext keys are never stored or logged.
- **allocations** — one row per beneficiary (`beneficiary_id UNIQUE` = idempotency guard),
  `tier`, `amount_phpc CHECK IN (5000, 3500)`, `onchain_tx_hash`, `reconciled`.
- **merchants** — `auth_user_id → auth.users`, store/owner name, `mobile_number_e164`, nullable
  `wallet_address`, `wallet_balance NUMERIC(12,2) >= 0` (custodial off-chain earnings),
  `cashout_in_progress`, `status ∈ {PENDING, APPROVED, REJECTED, SUSPENDED}`.
- **transactions** — `item_list_jsonb`, `total_amount`, `total_credit_deducted`,
  `stablecoin_amount_wei` (TEXT), `onchain_tx_hash`, `idempotency_key UNIQUE`,
  status CHECK `PENDING_CHAIN | SUBMITTED | CONFIRMED | RECONCILED | FAILED`.
- **products** — `name`, `category`, `eligibility_status ∈ {eligible, ineligible}` (lowercase),
  `price_range_min/max` with `max >= min`, `image_url`, `reference_image_url`,
  `image_embedding vector(768)`.
- **qr_passes** — `beneficiary_id`, `token_payload` (the signed JWS), `issued_at`, nullable
  `expires_at`, `revoked`.
- **outbox** — `kind`, `payload_jsonb`, `status ∈ {PENDING, PROCESSING, DONE, FAILED}`, `attempts`,
  `last_error`. Kinds in use: `TRANSACTION_CHAIN_SUBMIT`, `BALANCE_RESTORATION_AUDIT`.
- **market_prices** — DA/PSA-style reference prices used by `pricing-validation.service.ts`;
  unique on `(commodity_name, market_location, source, as_of_date)`.
- **photo_receipts** — typed in `@bantayog/db` for expiring cart-photo references.

## Approved Rural offline data model — planned

ADR-004 approves eight additive objects. They are not in the current database:

- `merchant_devices` — Rural device public key, merchant ownership, app variant, status, and key
  version. The private key stays in Android Keystore.
- `beneficiary_merchant_assignments` — administrator-approved beneficiary and Rural merchant
  relationship, policy cap, validity, status, actors, reason, and audit timestamps.
- `offline_merchant_certificates` — signed device-bound local capability certificates. They cannot
  authorize sync, provisioning, release, cash-out, or administration.
- `offline_credit_reservations` — a signed quota bound to one assignment, beneficiary, merchant, and device.
  It lasts for at most 30 days. The server must count all active reservation remaining amounts
  while it locks the beneficiary row. All devices for one merchant share one aggregate merchant
  policy cap.
- `offline_transaction_events` — append-only device-signed local sale events with unique sale ID,
  assignment, local sequence, identification method, payload digest, and immutable server decision.
- `offline_sync_receipts` — one acknowledgement per event: `accepted`, `rejected`, or `conflict`.
- `offline_catalog_releases` — immutable canonical signed product and commodity policy releases.
- `offline_conflict_reviews` — append-only admin actions that never change the original decision.

The global invariant is:

```text
credit_balance - sum(active reservation remaining amounts) >= new reservation amount
active distinct Rural merchant IDs with remaining reservation > 0 <= 7
```

The seventh distinct Rural merchant may receive a permit. An eighth distinct merchant must be
rejected. Multiple devices for one merchant count as one merchant.

The server uses receipt time for permit expiry. A device timestamp cannot extend a permit. Expiry
or release removes the reservation from the active sum and never increments `credit_balance`.
Signed payment payloads and application code use whole integer credits. Postgres money uses
`NUMERIC(12,2)`, and offline credit amounts must have `.00`.

For an accepted event, one Postgres transaction must move money, consume the reservation, insert
the official transaction, store the final event decision, and insert the synchronization receipt.

The implementation must add the next migration and mirror every row and function in
`packages/db/src/types.ts` and `packages/db/src/types.test.ts`. `PENDING_SYNC` is a local or sync
state. It is not a new `transactions.status` value.

## RPCs

- `settle_sale(p_beneficiary_id, p_merchant_id, p_amount, p_items, p_transaction_id)` —
  `SECURITY DEFINER`; validates amount > 0, `SELECT ... FOR UPDATE` on the beneficiary, raises on
  insufficient credit, deducts credit, credits merchant `wallet_balance`, inserts the transaction
  as `CONFIRMED`, returns the transaction id. This is the only sanctioned money-movement path.
- `claim_outbox_rows(p_limit)` — `SELECT FOR UPDATE SKIP LOCKED` claim primitive
  (`claimPendingOutboxRows` in `@bantayog/db`). The current reconcile cron instead does a
  `PENDING → PROCESSING` update; both exist.
- `match_product_embeddings(query_embedding, match_threshold, match_count)` — cosine kNN over
  `products.image_embedding`.
- `has_role(required_role)` — reads `auth.users.raw_app_meta_data->>'role'`; `admin` satisfies
  every role check.

## RLS

Enabled on all app tables. Pattern: `admin_all_<table>` via `has_role('admin')`; merchants may
read/update their own `merchants` row and read/insert `transactions` where `merchant_id` maps to
their `auth_user_id`; `products` and `market_prices` are readable by any authenticated user.
Storage buckets are private, with admin-only writes on `reference-images`.

The API server uses the service role key (`createServiceClient()`), which bypasses RLS — so route
guards and explicit ownership checks are the real enforcement. Keep both in sync.

## Verified SQL ↔ TypeScript drift (do not trust `types.ts` alone)

`packages/db/src/types.ts` has fallen behind the migrations. Confirmed differences:

| Item | SQL | `types.ts` |
| --- | --- | --- |
| `beneficiaries.intervention_tier` | exists (00002) | missing from `BeneficiaryRow` |
| `transactions.total_amount` | exists (00001) | missing from `TransactionRow` |
| `TransactionStatus` | `PENDING_CHAIN, SUBMITTED, CONFIRMED, RECONCILED, FAILED` | adds `DB_RECORDED`, `BROADCAST` (CHECK rejects them), omits `SUBMITTED` |
| `outbox.last_error` | exists (00002) | missing |
| `outbox.run_after` | no migration creates it | present in `OutboxRow` |
| `photo_receipts` table | no migration creates it | fully typed |
| `claim_outbox_rows()` | no migration creates it | typed under `Functions` |

Consequences: never write `DB_RECORDED`/`BROADCAST` to `transactions.status`; expect
`intervention_tier`, `total_amount`, and `last_error` reads to need casts; verify
`photo_receipts` / `claim_outbox_rows` actually exist in the target database before using them.
Reconciling this file with the migrations is a genuinely useful cleanup task.
