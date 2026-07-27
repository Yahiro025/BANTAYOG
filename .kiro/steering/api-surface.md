---
inclusion: manual
---

# API Surface (apps/server)

Middleware order in `src/app.ts`: CORS (`CORS_ORIGIN`, default `http://localhost:3000`) →
pino request logger → global rate limit (100/60s per IP) → endpoint-specific rate limits →
per-route-group `authMiddleware` + `requireRole(...)`.

`authMiddleware` never rejects; it verifies the Bearer token via `supabase.auth.getUser()` and
sets `c.get('user')` to `{id, email, role}` or `null`. `requireRole` does the rejecting
(401 when no user, 403 when the role is wrong). Role comes from `user.app_metadata.role`.

## Route groups

| Prefix | Guard |
| --- | --- |
| `GET /health` | public |
| `/api/auth/*` | public except `POST /logout` (admin+merchant) |
| `/api/balance/*` | **intentionally public** — the signed QR token is the authorization |
| `/api/merchants/me`, `/api/merchants/me/*` | merchant (registered before the admin wildcard — order matters) |
| `/api/beneficiaries*` | admin |
| `/api/merchants*` | admin |
| `/api/chain*`, `/api/products*`, `/api/transactions*` | admin + merchant |
| `/api/vision*` | merchant |
| `/api/cron/*` | no session; `Authorization: Bearer $CRON_SECRET` checked inside the handler |

## Endpoints

Auth (`routes/auth.ts`)
- `POST /api/auth/login` — admin email+password; rejects non-admins and signs them back out.
- `POST /api/auth/merchant-login` — mobile → `<digits>@merchant.bantayog.local`; blocks
  `SUSPENDED`; returns access + refresh token and merchant summary.
- `POST /api/auth/merchant-refresh` — refresh-token exchange.
- `POST /api/auth/wallet-login` — EVM `personal_sign` proof → matches an APPROVED merchant by
  `wallet_address`, then mints a session via admin magiclink + `verifyOtp`.
- `POST /api/auth/verify-pin` — 6-digit PIN check (no lockout on this path).
- `POST /api/auth/verify-qr` — verifies the JWS token, rejects revoked/expired passes, then
  re-evaluates tier and returns the beneficiary.

Beneficiaries (admin) — list/create/detail, QR pass issue, one-time allocation trigger. The
allocation amount is derived from the computed tier, never from the request body.

Merchants (admin) — registration/approval/suspension and listing.

Merchant self (`routes/merchant-self.ts`)
- `GET /api/merchants/me` — profile DTO incl. `walletBalance`, `connected`; 403 if suspended.
- `POST /api/merchants/me/wallet` — validates 0x+40-hex address and verifies `verifyMessage`
  ownership before persisting.
- `POST /api/merchants/me/cashout` — requires connected wallet and positive balance; takes the
  `cashout_in_progress` lock via conditional update, transfers PHPC, waits up to 300s for
  confirmation, then zeroes the balance. Every failure path releases the lock and returns 502.

Transactions (`routes/transactions.ts`)
- `POST /api/transactions` (merchant) — body: `qrToken`, 6-char `pin`, `items[]`
  (`category` from the 9-value nutrition enum, `name`, `quantity`, `unitPricePhp`, `creditCost`),
  `idempotencyKey` (UUID, also used as the transaction id), optional `photoStoragePath`.
  Order: merchant APPROVED → QR token → `qr_passes.expires_at` (note: `revoked` is **not**
  checked here) → beneficiary not SUSPENDED/INELIGIBLE → PIN with lockout → total > 0 →
  sufficient balance → `settle_sale` RPC. Returns 201 with the DTO plus `remainingBalance`.
- `GET /api/transactions` — paginated (`page`, `limit`, `status`); merchants are force-scoped to
  their own rows.
- `GET /api/transactions/:id` — merchants get 403 on rows they do not own.

Vision (merchant, `routes/vision.ts` + `services/vision.service.ts`). All bodies cap
`imageBase64` at ~15 MB.
- `POST /api/vision/classify` — Gemini candidate names + confidence (threshold
  `GEMINI_CONFIDENCE_THRESHOLD`, default 0.7), each fuzzy-matched against `products`.
- `POST /api/vision/analyze-nutrition` — grounded child-suitability verdict.
- `POST /api/vision/analyze-scan` — the flow the merchant app actually uses: one call returning
  `blurry | unrecognized | identified`, child-friendliness, flagged ingredients, category, and a
  researched PHP base price; identified products are upserted through
  `ProductsService.validateOrCreateProduct` (price range = base ±10, `eligibility_status` from
  child-friendliness, `category` defaults to `Draft` when unknown).
  Gemini quota/format errors are translated to `rate_limit:` / `image_error:` / `scan_error:`
  prefixed validation errors.
- `POST /api/vision/validate-non-branded` — palengke items: image + manual `productName`,
  `price`, `unit` validated against `market_prices` by `PricingValidationService`.

Only `/classify` and `/analyze-nutrition` carry the 10/60s Gemini rate limit in `app.ts`;
`/analyze-scan` and `/validate-non-branded` fall back to the global 100/60s limit despite being
the heavier Gemini callers. Worth tightening if you touch that area.

Balance (public, `routes/balance.ts`)
- `GET /api/balance/view?token=<qrToken>` — failure precedence: invalid/expired token →
  `invalid_pass`; unresolvable beneficiary → 404 `not_matched`; retrieval failure → 503
  `temporarily_unavailable`. Success returns name, balance, and ≤50 transactions, newest first.

Cron
- `POST /api/cron/reconcile` — drains up to 20 `PENDING` `TRANSACTION_CHAIN_SUBMIT` outbox rows,
  transfers PHPC to the merchant wallet, waits for the receipt, marks `DONE`/`CONFIRMED`; retries
  up to 3 attempts then marks `FAILED` and runs the balance-restoration compensator.
- `POST /api/cron/tier-reeval` — nightly Tier 1 → Tier 2 transitions.

## Rate limits (Upstash sliding window)

`login` 5/60s · `merchant-login` 5/60s · `verify-pin` 3/60s · `vision/classify` and
`vision/analyze-nutrition` 10/60s · global 100/60s.

## Error contract

`{ error: <tag>, message, details? }` with tags `validation` (400), `auth` (403, or 401 when
`code === 'expired'`), `rateLimit` (429), `onchain` (502), `persistence` (500), `jwt` (401),
`policy` (422). Some handlers also return ad-hoc tags (`not_found`, `forbidden`, `conflict`,
`invalid_pass`) — match the surrounding file rather than "fixing" them piecemeal.
