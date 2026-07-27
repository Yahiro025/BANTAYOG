---
inclusion: manual
---

# Security Model

`docs/SECURITY.md` is the public-facing policy; this file records what the code actually does,
including the places where the two disagree.

## Identity

- **Admin** — Supabase email+password. `app_metadata.role` must be `admin`; the login route signs
  non-admins back out. `apps/web/middleware.ts` additionally 404s `/admin/*` for non-admin
  sessions (404 rather than 403, to avoid advertising the portal).
- **Merchant** — Supabase password auth against a derived email
  `<mobile-digits>@merchant.bantayog.local`. Access + refresh tokens live in `localStorage`
  (`bantayog_merchant_access_token`, `..._refresh_token`, `..._expires`) and `authFetch` refreshes
  them 30s before expiry. `SUSPENDED` merchants are rejected at login and on `/api/merchants/me`.
  Wallet login is also supported via a `personal_sign` proof matched to an APPROVED merchant.
- **Beneficiary** — no credentials. A JWS (HS256) QR token carries
  `{beneficiaryId, childName, guardianName, tier, pin_hash_ref, walletRef}`.

## QR passes

- Tokens are signed with `QR_TOKEN_SECRET` and are **not** time-limited: `generateToken` sets
  `iat` only (`QR_TOKEN_TTL_SECONDS` is validated in config but unused). Revocation and expiry are
  enforced by the `qr_passes` row instead — but only partially: `POST /api/auth/verify-qr` checks
  both `revoked` and `expires_at`, while `POST /api/transactions` and `GET /api/balance/view`
  check `expires_at` only. A revoked pass can therefore still transact. Treat this as a real gap.
- `QrTokenService.getSecretKey()` falls back through `JWT_SIGNING_SECRET` → `JWT_SECRET` → a
  hardcoded literal. That fallback is a real risk in any non-local environment: always set
  `QR_TOKEN_SECRET` explicitly, and treat removing the literal as a valid hardening change.
- `verifyToken` distinguishes `expired` from `invalid` and never returns a payload on failure.

## Guardian PIN

6 digits, hashed with Argon2id (`@node-rs/argon2`); no plaintext or reversible form is stored.
`verifyPinWithLockout` (used by the purchase route) tracks `pin_fail:{id}` and `pin_lock:{id}` in
Upstash: 5 consecutive failures → 900s lock reported as `RateLimitError` (429), reset on success.
If Upstash is not configured the lockout silently degrades to plain verification — deliberate, and
worth remembering when reasoning about brute-force exposure. `POST /api/auth/verify-pin` uses the
non-lockout path.

## Authorization

`requireRole(...)` at the route-group boundary is the primary gate. Postgres RLS
(`has_role()`-based policies) is defense in depth only, because the server uses the service role
key. Any new route that returns merchant-scoped data must re-check ownership explicitly, as
`routes/transactions.ts` does when forcing `merchantId` for merchant callers.

Intentionally public: `GET /health` and `/api/balance/view` (the signed token is the credential).
Never add mutating capability under `/api/balance`.

## Rate limits

Upstash sliding windows: login 5/60s per IP, merchant-login 5/60s, verify-pin 3/60s per
beneficiary, vision endpoints 10/60s per merchant (Gemini quota guard), global 100/60s per IP.

## Secrets & logging

- pino redacts by key name (`pin`, `pin_hash`, `password`, `privateKey`, `authorization`) in
  `lib/logger.ts`; `lib/redact.ts` adds value-based redaction that recursively replaces known
  secret strings (deployer key, key-encryption key, QR secret, a decrypted custodial key) even
  when embedded in an unrelated error message. Use `collectConfiguredSecrets` + `redactSecrets`
  before logging anything derived from chain operations.
- Custodial beneficiary keys exist in plaintext only in memory during signing; at rest they are
  AES-256-GCM ciphertext under `CUSTODIAL_KEY_ENCRYPTION_KEY`, stored separately from the chain
  config.
- `DEPLOYER_PRIVATE_KEY` never crosses to the client. `.env*` files are gitignored except
  `.env.example`.

## Known drift to be aware of

- `docs/SECURITY.md` states scanned images are never stored. In the current `analyzeScan` path,
  `ProductsService.validateOrCreateProduct` persists the scan as a base64 data URL in
  `products.image_url`, and migration 00005 adds a `reference-images` bucket. Treat the doc as
  aspirational; if you touch that flow, either stop persisting images or update the doc.
- `docs/SECURITY.md` describes on-chain `processTransaction` enforcement; today's reconcile cron
  performs a plain treasury→merchant PHPC transfer instead (see `blockchain.md`).
- CORS defaults to `http://localhost:3000` when `CORS_ORIGIN` is unset — set it per environment.
