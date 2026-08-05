# Security Policy

This document details the security model, configuration guidelines, and authorization systems implemented in BANTAYOG.

## Authentication Architecture

BANTAYOG implements a hybrid authentication system to support LGU administrators and Sari-sari store merchants:

1. **LGU Admin Auth**: Uses standard email and password authentication powered directly by Supabase Auth (`supabase.auth.signInWithPassword`). The admin portal redirects requests on success.
2. **Merchant Auth**: Uses a custom wrapper login flow mapping a mobile number to a derived merchant email address (`[mobile]@merchant.bantayog.local`) in Supabase Auth.
3. **QR Pass Identification**: Beneficiaries do not have a credentials login. They use a signed JWS compact JWT (signed with `QR_TOKEN_SECRET` using HS256) embedded in a physical QR Pass. The token encodes `{ beneficiaryId, childName, guardianName, tier, pin_hash_ref }`.

## Authorization System (RBAC)

Role-Based Access Control is enforced at the route boundary in Hono:
- **Admin role**: Granted full CRUD access on all tables (`beneficiaries`, `merchants`, `transactions`, `products`, `qr_passes`).
- **Merchant role**: Restricted to reading and updating their own profiles, validating QR codes, and inserting/viewing their own `transactions`.
- **Anons/Public**: Restricted access. Public health check `/health` is exposed.

The `requireRole` middleware checks the decoded token's user role metadata and rejects unauthorized requests with a `403 Forbidden` response.

## Data Protection & Privacy

1. **Argon2id Hashing**: Beneficiary verification PINs are hashed using Argon2id (`@node-rs/argon2`). No raw PINs are stored.
2. **Log Redaction**: Pino structured logs are configured to automatically redact sensitive parameters including `pin`, `pin_hash`, `password`, `privateKey`, and `authorization`.
3. **No Image Storage**: AI Product Scanner base64 photos are classified inline and in-memory by Gemini and immediately discarded. Images are never stored in databases or static directories.

## API Security & Rate Limiting

Rate limiting is enforced at the API route boundary using `@upstash/ratelimit` with sliding windows:
- `/api/auth/login` & `/api/auth/merchant-login`: Max 5 requests per 60 seconds per IP (anti-brute-force).
- `/api/auth/verify-pin`: Max 3 requests per 60 seconds per Beneficiary ID (anti-PIN-cracking).
- `/api/vision/classify`: Max 10 requests per 60 seconds per Merchant User ID (Gemini API quota guard).
- Global: Max 100 requests per 60 seconds per IP.

## Blockchain Security

- **Stellar Secrets**: The issuer, distribution, and sponsor account secret seeds
  (`PHPC_ISSUER_SECRET`, `PHPC_DISTRIBUTION_SECRET`, `STELLAR_SPONSOR_SECRET`) are stored securely
  on the environment boundary and never exposed to the client. Beneficiary and merchant custodial
  keys are encrypted at rest with AES-256-GCM under a separate `CUSTODIAL_KEY_ENCRYPTION_KEY`.
- **Issuer-Enforced Policy**: PHPC is a classic Stellar asset with `AUTH_REQUIRED` (only
  LGU-authorized trustlines can hold PHPC), `AUTH_REVOCABLE` (the LGU can freeze a holder's
  balance), and `AUTH_CLAWBACK_ENABLED` (the LGU can reclaim misused subsidies) issuer flags set
  at bootstrap. There is no custom bookkeeping contract; Stellar's native ledger enforces balances.

## Planned Rural Offline Security

ADR-004 defines the Rural offline extension. It is not implemented in the current checkout.

- Rural devices must never receive a full beneficiary balance.
- Only an active administrator-approved beneficiary-merchant assignment can authorize Rural
  search, provisioning, PIN verifier creation, or reservation issuance. A merchant cannot self-assign.
- The backend issues signed reservations bound to one beneficiary, merchant, and device. A permit
  lasts for at most 30 days. The phone stops sales 24 hours before expiry, and the server uses its
  receipt time for expiry. Active reservations across all merchants must fit within the
  beneficiary's unreserved credit. The backend allows at most seven distinct Rural merchant IDs
  with active reservation remaining amounts for one beneficiary. Multiple devices for one merchant
  count as one merchant and share one aggregate merchant cap.
- Rural sale events are device-signed and remain pending until the backend verifies them and
  settles them in Postgres.
- A Rural permit-backed sale creates one sale ID and one local signed event before its first upload.
  Timeout, late response, retry, restart, and offline queue reuse the same event.
- Urban no-card payments use live beneficiary name search and server-side PIN verification.
- Rural may receive a separate device-bound offline PIN verifier. It must not be the canonical
  server Argon2id hash, a plaintext PIN, or an online API credential.
- Five failed offline PIN attempts lock no-card payment until online re-provisioning. Signed
  per-sale, total-amount, and event-count limits must be present and must be lower than with-card
  limits. The first controlled-pilot upper limits are 200 credits per sale, 500 credits in total,
  and three successful events. This is a local deterrent, not server proof of guardian consent on
  a compromised phone.
- Expiry or release never increments the beneficiary balance. Accepted money movement, final event
  decision, and sync receipt commit in one Postgres transaction.
- Manual release requires fresh online authentication and records actor, reason, and server time.
- QR pass version 2 must use ES256 P-256 with a minimal payload and no HMAC fallback. Every pass
  route checks expiry and revocation. QR, permit, and catalog keys are separate and rotate with an
  overlap period.
- Catalog releases are administrator-created, immutable, validated, signed, and installed
  atomically. An invalid install keeps the last-known-good release.
- Both APKs use the shared Branded barcode scanner. Gemini is an online fallback identifier only.
  The catalog decides eligibility. The app must not use Gemini child-friendliness, an unmatched
  product, or a `VEGETABLES` default to authorize a sale.
- The demo Gemini request must contain a product-only crop and no beneficiary, guardian, merchant,
  PIN, pass, or transaction data. Recheck Google's free-tier pricing and data-use terms before the
  demo. Real-user use needs a separate privacy and provider review.
- Rural fallback is limited to network, DNS, timeout, 408, 429, and 5xx and requires a valid
  assignment, permit-pinned catalog, offline merchant certificate, permit, and beneficiary verifier.
  It must not bypass policy, image, authentication, signature, or configuration failures.
- The offline merchant certificate and native merchant unlock permit local actions only. Fresh
  online authentication is required for sync, provisioning, release, cash-out, and administration.
- Conflict review is append-only. It cannot change the original decision or directly edit money.
  Any remediation is a new fully authorized online transaction.
- Expired or revoked assignments purge local directory and PIN verifier data. Pending and Needs
  Review events remain until receipt or resolution. Device replacement never copies a private key.
- Local Rural earnings are not cash-outable until the server accepts the event.
- GCash, GoTyme, and bank-account payouts are not implemented. They are future partnership plans
  only and need separate provider, compliance, and security approval.

## Reporting Vulnerabilities

If you discover a security vulnerability in this project, please open an issue or contact the project maintainers directly.
