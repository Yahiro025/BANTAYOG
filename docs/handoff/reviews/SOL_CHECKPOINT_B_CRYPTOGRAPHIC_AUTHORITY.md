# Sol Checkpoint B: Cryptographic Authority Review

Date: 2026-08-05

Reviewed revision: `d6fb4c94ab178e5bec542ce4701787688ef6cb32`

Status: **BLOCKED**

Task 3 must not start implementation until findings B-01 through B-04 are resolved in the frozen
event contract and approved by the owner. The owner must separately approve QR migration and each
native dependency.

## Scope

This review covers:

- canonical event bytes and payload digest rules;
- ES256 key and signature formats;
- QR, permit, catalog, certificate, and device trust domains;
- QR pass version 2 migration;
- the device-bound offline PIN verifier; and
- Android Keystore behavior on low-end phones.

This review does not change QR signing, keys, authentication, or native dependencies.

## Findings

### B-01 — Critical: `payloadHash` has no defined non-circular meaning

The canonical event bytes include `payloadHash`. The documents call this value the canonical
payload digest, but they do not define whether it is a digest of the same canonical bytes. If it
is, construction is circular.

Required correction:

- Define `unsignedEventPayload` as all signed event fields except `payloadHash` and `signature`.
- Canonicalize that payload once.
- Compute `payloadHash = base64url(SHA-256(canonicalBytes))`.
- Sign a domain-separated value that contains the canonical bytes or their defined digest.
- Never use signature bytes as the idempotency digest because ECDSA signatures are not a stable
  content identifier.

### B-02 — Critical: required authorization fields are optional

`merchantCertificateVersion` is optional for every event. The PIN verifier version and PIN audit
fields are also optional for a `NO_CARD_PIN` event. This permits an event that cannot prove which
signed local policy it claims to use.

Required correction:

- Require `merchantCertificateVersion` for every permit-backed event.
- For `NO_CARD_PIN`, require `pinVerifierVersion`, `failedPinAttemptCount`, and a positive
  `pinSuccessfulUseOrdinal`.
- For `CARD_QR`, require the QR pass reference and pass version that the server will verify. Do not
  include a full QR token or private beneficiary data in the event.
- Reject fields that are inconsistent with the selected authorization method.
- Enforce no-card limits from server records. Do not trust the device ordinal as authority.

### B-03 — Critical: the signed item identity is ambiguous

An item can contain both `productId` and `commodityId`. The event also has only one identification
method for the complete cart. A cart can contain items that use different identification paths.

Required correction:

- Require exactly one of `productId` or `commodityId` for each item.
- Put `identificationMethod` on each item, or prove and document that one event contains only one
  item.
- Require the method to match the identifier type and the signed catalog evidence.
- Prohibit `ONLINE_GEMINI` in an event created while the device is offline.

### B-04 — Critical: cross-language canonical encoding is not specified

Fixed array order is useful, but it does not define Unicode normalization, string escaping,
number encoding, absent values, or Android ES256 signature encoding. Android `Signature` normally
returns ASN.1 DER, while JWS ES256 uses a fixed 64-byte `R || S` value.

Required correction:

- Freeze a versioned canonical encoding and UTF-8 rules.
- Normalize signed user-controlled text to NFC before validation and signing, or prohibit it from
  signed identity fields and use stable catalog IDs.
- Use decimal strings for signed money and other values that can cross numeric runtimes.
- Define the event signature as base64url without padding over one exact byte format.
- If the format is JWS-compatible ES256, convert and test DER to fixed-width `R || S` correctly.
- Publish one byte-for-byte TypeScript and Kotlin test-vector file.

### B-05 — Critical: the current QR implementation is not acceptable for Rural use

The current QR service uses HS256, a server-secret fallback, and private payload fields. Rural
offline verification must remain disabled until version 2 replaces it. No HMAC compatibility
fallback is allowed.

## Approved cryptographic profile

- Algorithm: ES256 with P-256 and SHA-256.
- Public-key transport: a documented P-256 SPKI encoding with base64url without padding.
- Event signature transport: one documented base64url encoding with no alternative format.
- Signed object header: format version, algorithm, key ID, and trust domain.
- Trust domains: separate QR, permit, and catalog key pairs. The permit domain can sign the
  offline merchant certificate only if the certificate type has its own domain-separation prefix.
- Device key: generated as non-exportable in Android Keystore. Record whether hardware-backed
  storage is available. Do not require StrongBox on low-end phones.
- Rotation: publish old and new public keys before use, support a bounded overlap, and reject a
  retired key after its valid objects expire.
- QR v2 payload: issuer, audience, pass ID, opaque beneficiary reference, pass version, key ID,
  issue time, expiry, and revocation version only.

## Required acceptance tests

- [ ] Freeze a canonical TypeScript vector that contains multiple items, null optional fields,
  Unicode text, maximum allowed integers, and all authorization fields.
- [ ] Make Kotlin produce the exact same canonical-byte hex and SHA-256 digest.
- [ ] Verify a TypeScript signature in Kotlin and a Kotlin signature on the server.
- [ ] Reject a changed field, wrong key, wrong key ID, wrong trust domain, wrong algorithm, wrong
  format version, malformed DER, malformed raw signature, and invalid P-256 public key.
- [ ] Prove that signature variation does not change the idempotency digest.
- [ ] Require exactly one product or commodity identifier per item.
- [ ] Require the correct authorization-specific fields and merchant certificate version.
- [ ] Reject a missing no-card per-sale limit, total limit, or event-count limit.
- [ ] Test correct PIN, incorrect PIN, five-attempt lock, restart persistence, expiry, wrong
  beneficiary, wrong device, verifier replay, and online re-provision unlock.
- [ ] Enforce pilot no-card upper limits of 200 credits per sale, 500 total, and three accepted
  events. Prove that lower permit limits win.
- [ ] Prove that the online server never accepts the offline verifier as a credential.
- [ ] Reject QR v1 and all HS256 tokens on every QR-accepting route after the approved reset.
- [ ] Test QR expiry and revocation on authentication, transaction, balance, provisioning, and
  synchronization routes.
- [ ] Test separate QR, permit, and catalog key rotation with old/new overlap and retirement.
- [ ] Reject an unauthenticated public-key metadata update.
- [ ] Scan both APK artifacts. Confirm that no private key, HMAC secret, PIN, verifier value, or
  server signing configuration is present.

## Evidence

- The frozen event canonicalizer is deterministic inside TypeScript for the current test fixture.
- No Kotlin cross-language vector exists yet.
- The current server QR service still uses HS256 and a fallback secret. This is expected baseline
  behavior, but it blocks Rural offline QR verification.

