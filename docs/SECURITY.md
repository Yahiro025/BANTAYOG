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

## Reporting Vulnerabilities

If you discover a security vulnerability in this project, please open an issue or contact the project maintainers directly.
