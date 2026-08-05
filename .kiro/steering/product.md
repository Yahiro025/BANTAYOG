---
inclusion: always
---

# Product Overview

BANTAYOG turns LGU nutrition cash grants into traceable, nutrition-locked subsidies for the
Philippine "First 1,000 Days" cohort (RA 11148). A guardian receives a printed QR "Nutri-Pass"
instead of cash; credits can only be spent on child-appropriate food at approved sari-sari
stores, and settlement is recorded on Polygon Amoy testnet using a mock PHPC token.

Built for SparkFest 2026 (GDG on Campus – PUP) by a 4-person team, and entered in the **Cryptita
Plays Builder Showcase at WOCEE 2026** — live pitch on August 8, 2026 at SMX Convention Center
Manila, submitted under the *Bayanihan Finance* category (event facts and stage scope live in
`docs/SHOWCASE.md`). Hackathon-stage code: testnet only, demo-grade in places, but the
architecture is real (see ADRs in `docs/adr/`).

## Three user surfaces (one Next.js app, sandboxed by hostname)

| Surface | Routes | Auth |
| --- | --- | --- |
| LGU admin portal | `/login`, `/admin/*` | Supabase email+password, `app_metadata.role === 'admin'` |
| Merchant POS PWA | `/merchant-login`, `/dashboard`, `/cart/*`, `/checkout/*` | Supabase password on derived email `<mobile>@merchant.bantayog.local`; token in localStorage |
| Public balance view | `/balance` | None — authorized solely by the signed QR token in the URL |

Beneficiaries have no login and no app surface. The QR pass is the only interface.
`apps/web/middleware.ts` 404s cross-surface routes when the hostname is a merchant/balance
subdomain (localhost is exempt so all surfaces work in dev).

## Core flows

- **Registration (admin).** Guardian + child, income, GPS, 6-digit guardian PIN (Argon2id),
  card serial. A custodial EVM wallet is generated per beneficiary; its private key is stored
  only as AES-256-GCM ciphertext.
- **Tiering.** Tier is computed, never stored as ground truth: Tier 1 (Critical) while age from
  conception ≤ 1,000 days (= ≤ 730 days from birth), else Tier 2 (Standard). Recomputed on read,
  at scan time, and by a nightly cron (ADR-002).
- **Allocation.** One-time tier-based PHPC allocation: Tier 1 = 5,000 PHPC, Tier 2 = 3,500 PHPC.
  The `allocations.beneficiary_id` UNIQUE constraint is the idempotency guard.
- **Scan → cart (merchant).** Merchant photographs a product. Gemini returns
  `blurry | unrecognized | identified` plus a child-safety verdict, category, and researched PHP
  base price. Eligibility itself always comes from the `products` catalog, never from the model
  (ADR-003). Unknown identified products are auto-inserted as draft catalog rows.
- **Checkout.** Verify QR token (JWS HS256) → check `qr_passes.expires_at` → verify guardian PIN
  with lockout → reject non-positive or over-balance totals → `settle_sale` Postgres RPC
  atomically deducts beneficiary credit, credits the merchant's off-chain `wallet_balance`, and
  inserts the transaction as `CONFIRMED`. (`qr_passes.revoked` is only checked by
  `POST /api/auth/verify-qr`, not by checkout or the balance view — a known gap.)
- **Cash-out (merchant).** Merchant connects an EVM wallet with a `personal_sign` proof, then
  cashes out: `cashout_in_progress` flag guards concurrency, PHPC is transferred on-chain to the
  merchant wallet, and the off-chain balance is zeroed only after confirmation.
- **Balance view (guardian).** Scanning the pass shows current balance plus up to 50 past
  transactions, read-only, no mutating controls.

## Approved Urban and Rural merchant variants — planned

ADR-004 defines two APK variants. Urban no-card payment uses an online beneficiary name search,
then server-side PIN verification. Rural includes an assigned local beneficiary directory and can
validate a selected beneficiary, a product, and a bounded permit while offline.

An administrator approves each beneficiary Rural merchant assignment. A merchant cannot use a
name, PIN, pass, or beneficiary identifier to self-assign. One beneficiary can have at most seven
active distinct Rural merchant assignments.

Rural devices never receive a full beneficiary balance. The backend reserves separate amounts for
each beneficiary, merchant, and device before disconnection. It allows at most seven distinct Rural
merchant IDs for one beneficiary and rejects an eighth; multiple devices for one merchant count as
one merchant and share one aggregate merchant cap. A permit lasts for at most 30 days. The phone
stops sales 24 hours before expiry, and the server must receive an event before expiry. Local sales
remain pending until the server verifies the signed event and settles it. This extension is planned
and is not implemented in the current checkout.

Branded scanning is barcode-first in both APKs while online and in Rural while offline. Gemini is
the online fallback identifier. The catalog decides eligibility. For Non-Branded items, the signed
commodity policy decides item, unit, and price rules. Rural permit-backed sales create one local
event before immediate upload or offline queue, so a timeout cannot create a second sale.

GCash, GoTyme, and bank-account payouts are future partnership plans only. The current product
does not include their provider integrations or real-money transfer UI.

## Product constraints

- Offline tolerance matters: sari-sari stores have flaky data. The web app is a PWA (Serwist
  service worker, `/~offline` fallback). Prefer flows that degrade gracefully.
- Money is PHP with 2 decimals (`NUMERIC(12,2)`), and DB CHECK constraints forbid negative
  balances. Never introduce float drift into credit math.
- Testnet only. Polygon Amoy (chain 80002) with a mock PHPC token; `DEPLOYER_PRIVATE_KEY` is a
  zero-value testnet key. Never wire a mainnet key or mainnet RPC.
- Nutrition policy is government policy, not UI preference: keep tier rules, credit limits, and
  eligibility decisions server-side and deterministic.
- Low-literacy, low-end Android users. Keep merchant/guardian UI large-tap, few steps, Tagalog-
  friendly copy, and accessible (`@axe-core/react` is wired in).
