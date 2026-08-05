# ADR 004: Quota-Limited Offline Authorization for Rural Merchant APKs

Date: 2026-08-04

Last updated: 2026-08-05

Status: Accepted and finalized architecture; implementation pending explicit execution gates

## Context

BANTAYOG will have two merchant Android builds:

- **Urban (Standard)** — the current merchant workflow and online transaction features.
- **Rural (Exclusive)** — all Urban features plus offline product validation, beneficiary
  search, PIN validation, sale recording, and later synchronization.

Both builds support two payment choices:

1. **With Bantayog Card** — the merchant scans the beneficiary QR pass and follows the current
   payment flow.
2. **Without Bantayog Card** — the merchant selects the beneficiary and the beneficiary enters a
   PIN.

For Urban no-card payments, beneficiary name search is online. The backend returns a masked
beneficiary result, the merchant selects the correct result, and the backend verifies the PIN.
The PIN is an authenticator. It is not an account identifier, and it is not stored in the Urban
APK.

For Rural no-card payments, the merchant can search an assigned local beneficiary directory while
offline. After selection, the Rural APK validates a device-bound offline PIN credential before it
records the sale.

The Rural feature creates a cross-merchant double-spend risk. If disconnected sari-sari stores
each copy a beneficiary balance of 1,000 credits, the stores could accept more than the official
balance when they sync. The Rural design must support up to seven distinct Rural merchants
serving one beneficiary offline without copying the same balance.

A normal software APK cannot provide an unlimited, shared offline balance across independent
merchants. Offline payment designs use risk limits, later synchronization, or tamper-resistant
hardware. The reference guides are in the last section of this ADR.

## Decision

### 1. Use two build variants with one shared merchant codebase

The Urban and Rural APKs will share the merchant UI and online API contracts. A build variant or
equivalent release configuration will control the additional Rural capabilities.

Urban will not include the Rural offline beneficiary directory, offline permits, or offline sale
queue.

Rural will include the offline product catalog, assigned beneficiary directory, offline permit
store, encrypted local transaction store, signed outbox, and background synchronization worker.

The server must treat the registered device capability and app variant as authoritative. A client
must not enable Rural capabilities only by changing a local flag.

Barcode scanning is a shared merchant capability. Both Urban and Rural APKs must contain the
shared barcode scanner for Branded products. Rural-only catalog storage, OCR, permit storage, and
offline transaction classes stay in the Rural source set.

### 2. Never copy the official beneficiary balance to a merchant device

The official Postgres ledger remains the source of truth for beneficiary credits and merchant
earnings.

The Rural APK stores no independent `credit_balance` copy. It stores only:

- a signed offline permit;
- the permit's local remaining amount;
- the permit issue time, expiry, and policy version;
- the assigned beneficiary search record;
- the signed product catalog;
- local transaction events and synchronization receipts; and
- local pending merchant earnings.

The local remaining amount is a spending limit. It is not a beneficiary balance.

### 2.1 Provision only approved merchant-beneficiary assignments

A Rural merchant must not obtain a directory record, PIN verifier, permit, or reservation only by
knowing a beneficiary name, identifier, QR pass, or PIN. An administrator must first create an
active `beneficiary_merchant_assignment` for that beneficiary and merchant.

The assignment contains the beneficiary ID, merchant ID, server policy cap, validity period,
status, approval actor, and audit timestamps. The database counts active merchant assignments,
not devices. One beneficiary can have at most seven active Rural merchant assignments. A demo can
seed these assignments, but a merchant cannot create or approve its own assignment.

Reservation issuance must lock the beneficiary row and verify the active assignment before it
calculates an amount. This rule prevents an unassigned merchant from reserving and blocking a
beneficiary's available credits.

### 3. Reserve offline quotas centrally before disconnection

Before a Rural device can spend offline, the official backend issues a bounded offline
reservation. A permit has a maximum lifetime of 30 calendar days from the server issue time. The
phone stops new offline sales 24 hours before the signed expiry. This safety period gives the phone
time to synchronize. The database locks the beneficiary row while it checks existing active
reservations.

For each beneficiary:

```text
available_for_new_spend =
  credit_balance - sum(active offline reservation remaining amounts)
```

The server must issue a new reservation only when the requested policy amount fits within this
available amount. The request must not allow the merchant to choose an arbitrary quota.

The server must also enforce this merchant-count rule while it holds the beneficiary row lock:

```text
active distinct Rural merchant IDs with remaining reservation > 0 <= 7
```

The limit is seven distinct `merchant_id` values per beneficiary. An approved policy may use fewer
than seven. An eighth distinct Rural merchant must not receive a new active reservation. Multiple
devices belonging to one merchant count as one merchant. While the beneficiary row is locked, the
server must also enforce:

```text
sum(active remaining amounts for this beneficiary and merchant)
  + new device reservation amount
  <= server policy cap for this beneficiary and merchant
```

This rule makes all devices for one merchant share one aggregate merchant allocation. A merchant
cannot multiply its allocation when it registers another phone.

Each reservation is bound to:

```text
reservationId
beneficiaryId
merchantId
deviceId
maximumCredits
remainingCredits
issuedAt
expiresAt
policyVersion
catalogVersion
nonce
serverSignature
```

Example:

| Official credit balance | Store A reservation | Store B reservation | Unreserved amount |
| ---: | ---: | ---: | ---: |
| 1,000 | 300 | 200 | 500 |

Store A can spend only its 300-credit permit. Store B can spend only its 200-credit permit. The
beneficiary may use both stores while both are offline, but the two stores cannot spend more than
the 500 credits reserved for them.

This Store A and Store B example is a subset of the rule. The same reservation model supports up
to seven distinct Rural merchants. When a reservation expires, is released, or reaches zero,
its merchant no longer counts as an active reservation holder.

An online transaction can spend only unreserved credits. An accepted offline event consumes its
reservation and the beneficiary credit in one database transaction. An unused reservation returns
to the available amount after expiry or explicit release. Expiry does not add money to
`beneficiaries.credit_balance`. It only removes the unused reservation amount from the active
reservation sum.

The backend must also provide an authenticated online release operation for the owning merchant or
an administrator. A release sets the reservation to an inactive state and records the actor,
reason, and server time. It never increases `credit_balance`. Automatic expiry remains required.

The server uses its receipt time for the expiry decision. It accepts a new event only if it receives
the event before the signed `expiresAt`. It must not use the phone's `createdAt` to extend a permit.
A merchant must synchronize before the permit expires.

The Rural APK warns the merchant seven days and 72 hours before expiry. It stops new sales 24
hours before expiry. It stores the last trusted server time and calculates a non-decreasing
effective local time. A backward clock change must not extend a permit. A large forward clock
change must fail closed and request an online time refresh. The server receipt time remains final.

### 4. Use one local-first, signed event path for permit-backed Rural sales

The Rural APK creates one `saleId` before final confirmation. It uses the same sale ID whether the
phone is online, offline, or loses its network after confirmation. The APK atomically consumes the
local permit amount and writes one signed local event before it attempts synchronization.

If the phone is online, it sends the event immediately. If the request fails because of network,
DNS, timeout, HTTP 408, HTTP 429, or HTTP 5xx, the event stays `PENDING_SYNC`. A late response or a
retry uses the same sale ID and event ID. It cannot create a second official transaction. The APK
must not fall back after a valid ineligible result, HTTP 400 invalid-image response, HTTP 401 or
403 response, or an invalid signature or configuration response.

Automatic offline fallback is available only when the Rural APK has an active permit, a valid
permit-pinned signed catalog, an active approved assignment, a valid offline merchant certificate,
and the required beneficiary verifier. If one item is missing, the APK shows `Offline unavailable`
and does not record a credit sale. `navigator.onLine` is only a display hint. The actual request
result and timeout control fallback.

The Rural device creates one append-only event for every permit-backed sale. The event is signed by the
device private key stored in Android Keystore and contains the reservation ID, beneficiary ID,
merchant ID, device ID, assignment ID, sale ID, event ID, `amountCredits`, item evidence, product
identification method, catalog version, policy version, and an informational device timestamp. The
server does not trust the device timestamp for permit expiry or revocation decisions.

The server accepts an event only when all of these checks pass:

- the device is registered, approved, and not revoked;
- the event signature is valid;
- the permit signature is valid;
- the permit belongs to the beneficiary, merchant, and device;
- the permit is active and has enough remaining amount;
- the catalog and policy versions equal the signed versions in the permit;
- the items are eligible;
- the event ID and transaction ID are idempotent; and
- the event has not already been accepted with different content.

Normal catalog and policy updates do not apply retroactively to a valid permit. The server checks
the signed versions that the permit names. A current emergency revocation for the merchant, device,
beneficiary, pass, reservation, or product moves the event to `conflict` and `Needs review`. It does
not increase the merchant's available balance until an administrator resolves it.

The local sale is `PENDING_SYNC`. It is not an official transaction until the server accepts the
event.

### 5. Keep PIN roles separate

#### Urban

Urban performs online name search when the beneficiary does not have the card. The backend first
resolves the beneficiary, then verifies the six-digit PIN against the canonical Argon2id verifier.
The Urban APK does not store the beneficiary PIN or a copy of the canonical verifier.

#### Rural

Rural uses the local beneficiary directory to select a beneficiary while offline. The backend
must provision a separate device-bound offline PIN verifier only after an online PIN verification
and device registration step.

For the first release, the guardian must enter the PIN during an online Rural provisioning or
refresh step. The server verifies the PIN over the authenticated connection, creates the separate
device-bound verifier package, and does not store the raw PIN. If the verifier package is not
already installed, Rural no-card offline payment is unavailable for that beneficiary.

This offline verifier must:

- not be the server's canonical `pin_hash_argon2id` value;
- be encrypted at rest with a key protected by Android Keystore;
- be scoped to the beneficiary, Rural device, app variant, and verifier version;
- enforce five failed attempts, then lock offline no-card payment until an online re-provision;
- expire or require re-provisioning under server policy; and
- never be accepted as a credential by an online API endpoint.

The server-signed verifier policy must also set a maximum no-card amount per sale, a maximum total
no-card amount, and a maximum number of successful no-card events. The implementation must fail
closed if one of these limits is absent. The no-card limits must be lower than the corresponding
with-card limits. Each signed sale event records the authorization method, verifier version,
failed-attempt count, and successful-use ordinal. The server enforces the no-card amount and
accepted-event limits again during synchronization.

The first controlled-pilot profile sets these upper limits: 200 credits for one no-card sale,
500 credits in total for one verifier, and three successful no-card events. The permit can set a
lower limit. A later ADR and security review are required to raise one of these limits.

The offline verifier is a local deterrent. It does not give the server cryptographic proof that a
guardian entered the PIN. A rooted or fully compromised merchant phone can bypass the screen or use
its registered key without a real PIN entry. Encryption, a memory-hard verifier, a permanent local
lock, small no-card limits, device registration, event signing, and synchronization audits reduce
the possible loss. They do not remove this limit. Stronger proof needs a beneficiary-held secure
credential, such as an NFC smart card that signs a transaction challenge. That is future work.

#### Rural merchant authentication while offline

The normal online merchant access token is not sufficient for a 30-day offline window. During an
authenticated provisioning session, the backend issues a signed, device-bound
`OfflineMerchantCertificate`. Its expiry must not be later than the permit expiry. Its capability
list is limited to local beneficiary search, local product validation, local PIN verification, and
local event creation. It cannot call sync, provision, release, cash-out, or an admin operation.

The Rural APK also uses a native merchant unlock that is separate from the beneficiary PIN. The
unlock verifier is protected by Android Keystore and has attempt limits. A fresh online merchant
session is always required to provision, synchronize, release reservations, or cash out. A later
server suspension can still affect a disconnected phone, so small limits, short permits, and sync
audits bound this residual risk.

### 6. Keep product eligibility catalog-backed and barcode-first

Both APKs use barcode-first identification for Branded products. An exact barcode catalog hit does
not need Gemini. When the phone is online, Gemini remains the fallback identifier if the barcode is
missing, unreadable, or unknown. Gemini, barcode, and OCR can identify a product. Only the BANTAYOG
catalog can decide eligibility.

The required paths are:

```text
Urban online  : shared barcode scan -> server catalog -> Gemini fallback -> server catalog
Rural online  : shared barcode scan -> signed local catalog -> Gemini fallback -> signed catalog
Rural offline : barcode -> signed local catalog -> OCR alias -> UNKNOWN and block
Urban offline : no transaction support
```

The audit result uses one of these values:

```text
ONLINE_BARCODE
ONLINE_GEMINI
OFFLINE_BARCODE
OFFLINE_OCR
OFFLINE_MANUAL_COMMODITY
```

The current online Gemini services must not use a model verdict as eligibility. They must not
auto-authorize an unmatched product, auto-create an approved product, or default an unknown
category to `VEGETABLES`. An unknown result maps to `OTHER` or `UNKNOWN` and blocks checkout until
an approved catalog record exists. The non-branded online path must also use the signed commodity
policy for eligibility, units, and price bounds. Gemini may compare identity or evidence only.

For non-branded goods that have no barcode or label, the signed release includes an approved
commodity list. The merchant selects a commodity, unit, quantity, and price. The list supplies the
commodity identifier, approved aliases, nutrition category, eligibility, allowed units, and price
range. An image model can suggest a commodity, but it cannot authorize it. An unknown commodity
blocks the offline sale.

OpenCV is limited to image quality and crop operations. A model or OCR result cannot authorize an
unknown product. An unknown product blocks an offline sale.

An administrator must create each catalog release through an authenticated release operation. The
operation validates duplicate barcodes, ambiguous aliases, categories, eligibility values,
commodity units, price ranges, and validity dates. It stores an immutable canonical payload,
digest, version, signature, policy version, key ID, and algorithm. The device installs a complete
release atomically and keeps the last-known-good release if installation fails. A permit pins the
catalog and policy versions.

### 7. Synchronize events, not database snapshots

The Rural APK sends append-only events with one idempotency key per event. It never uploads a full
local database as an authoritative replacement for Postgres.

The server returns one result per event:

```text
eventId
accepted | rejected | conflict
officialTransactionId, when accepted
reason, when rejected or conflicting
serverCursor
```

For an accepted event, one Postgres transaction must claim the event ID, verify current database
state, consume the reservation, deduct the beneficiary amount, credit the merchant, insert the
official transaction, store the final event decision, and insert the synchronization receipt. A
failure rolls back all of these writes. A rejected or conflicting event must store its event row
and receipt together without moving money. The existing transaction status values remain
unchanged. Local states such as `PENDING_SYNC` belong in the local store or a separate
synchronization record, not in the current transaction status CHECK.

### 7.1 Use QR pass version 2 and separate signing trust domains

Before Rural offline payment is enabled, the QR pass must use an asymmetric ES256 P-256 signature.
There must be no HMAC fallback. The demo has no production users, so the project can regenerate all
demo QR passes during this migration.

The QR payload contains only issuer, audience, pass ID, opaque beneficiary reference, pass version,
key ID, issue time, expiry, and revocation version. It must not contain a name, wallet reference,
balance, PIN hash, PIN reference, or another private field. Every route that accepts a pass,
including authentication, transactions, balance, provisioning, and synchronization routes, must
check both expiry and revocation.

QR pass, offline permit, and catalog release signatures use three separate key pairs. Each signed
object includes an algorithm, key ID, and format version. Rotation publishes overlapping trusted
public keys before an old key is retired. A device accepts key metadata only through the bundled
trust root or another already trusted signature. A device never accepts an unauthenticated key
update.

### 7.2 Use an append-only conflict and remediation workflow

The backend provides an administrator conflict queue and event detail view. The detail shows the
signed event, reservation, assignment, product evidence, and server decision. Review actions are
append-only. An administrator cannot edit the original event, directly change a balance, or change
the original decision from conflict to accepted.

The safe first-release action is `CLOSE_REJECTED`. An optional remediation is a separate online
transaction that runs all current identity, PIN, eligibility, amount, balance, and authorization
checks. It needs guardian authorization and links to the original conflict. The original conflict
stays unchanged. Invalid signatures, replay with changed content, wrong merchant or device,
over-limit amount, and ineligible products are terminal rejections.

### 7.3 Apply local data retention and device replacement rules

The Rural APK removes a beneficiary directory record and offline PIN verifier when its assignment,
permit, or device authorization expires or is revoked. It keeps `PENDING_SYNC` and `Needs review`
events until the server returns a receipt or an administrator records a resolution. After the
pilot retention period, it removes detailed accepted or rejected records 30 calendar days after
the server receipt or conflict resolution. It keeps only the minimum receipt for 90 calendar days
after that server action. A server-signed policy can shorten these periods. Raising them needs a
privacy review. It does not store full product images. It may store an image digest.

Device replacement is an online operation. The server revokes the old device, releases or expires
its unused reservations, and registers the new device. A private device key is never copied. If a
phone is destroyed before synchronization, its unsynchronized events are not recoverable. The
design reduces this loss with immediate sync, high-priority deadline sync, warnings, and small
limits, but it cannot remove this residual risk.

### 8. Keep cash-out online and server-controlled

An offline sale increases only local `pendingEarnings`. It does not increase the cash-out amount.

After server acceptance:

1. The official transaction is recorded.
2. The official merchant balance increases.
3. The device receives the acknowledgement.
4. The local event changes from pending to accepted.
5. The online cash-out path can use the accepted server balance.

The existing online testnet EVM wallet cash-out path remains separate from this Rural offline
extension, if it is retained by the current application. A Rural APK cannot confirm a cash-out
while offline. GCash, GoTyme, and bank-account transfers are not part of the current
implementation.

### 9. Future plan: real-money payout partnerships — not implemented

GCash, GoTyme, and bank-account payouts are future work only. They may be implemented after
BANTAYOG has a formal partner agreement, approved provider APIs, compliance and identity rules,
merchant consent, fraud controls, security review, reconciliation, refund handling, and an
operational failure process.

This ADR does not authorize provider credentials, provider API routes, real-money transfer code,
or payout controls in either APK. Until a later ADR approves the work, the Rural feature only
tracks server-accepted merchant earnings. Pending local earnings are never cash-outable.

### 9.1 Demo cost boundary

The demo can use the existing free tiers, Gemini free quota, local open-source components, and the
Polygon Amoy testnet without a new mandatory provider fee. The implementation must set usage
limits and alerts and must not enable a paid automatic upgrade. If Gemini quota or service is not
available, the Rural build uses the allowed deterministic offline path. No real payout provider is
called. Before the demo, verify that the selected image-capable Gemini model still has a free tier.
Send only a product crop. Do not send beneficiary, guardian, merchant, PIN, pass, or transaction
data. Google's current pricing notice says that free-tier content can be used to improve its
products, so real-user use needs a separate privacy and provider review. This statement does not
claim that a production deployment has zero operating cost.

## Consequences

### Benefits

- Up to seven distinct Rural merchants can serve the same beneficiary without copying the same
  full balance to their devices.
- An eighth distinct Rural merchant cannot receive a new active offline permit for that beneficiary.
- The total offline exposure is capped before the network is lost.
- Online spending cannot consume credits already reserved for offline permits.
- Replayed events do not create duplicate official transactions.
- Urban remains simpler and does not receive Rural local data or offline risk.
- Cash-out remains tied to the official, synchronized merchant balance.

### Costs and limits

- Rural merchants cannot accept unlimited offline purchases. A beneficiary can have active offline
  reservations with at most seven distinct Rural merchants. A permit lasts for at most 30 days and
  the phone stops sales 24 hours before expiry.
- A Rural merchant must connect periodically to receive permits, catalog updates, revocations,
  and acknowledgements.
- If a beneficiary has no active permit for a store, that store must reject the offline sale.
- A rooted or compromised low-end phone can still falsify local display data or attempt to abuse a
  valid permit. The server must quarantine invalid events and keep the exposure limit small.
- A rooted merchant phone can bypass local PIN user-interface checks. No-card offline limits and
  merchant audit controls bound this risk, but they do not prove guardian consent.
- A merchant can misstate the weight, freshness, price, or delivery of a non-branded physical
  product. Signed commodity IDs, allowed units, integer-centavo price bounds, caps, optional image
  digests, and random audits reduce this risk. AI cannot prove the physical handover.
- A destroyed phone can lose an event that never reached the server. The merchant must resolve the
  loss operationally; the server cannot reconstruct an event or private key that it never received.
- A full cash-like offline purse would require a separate secure-element or token-payment design.

## Rejected alternatives

### Replicate `credit_balance` to every merchant

Rejected. Independent replicas cannot prevent two offline merchants from spending the same
balance.

### Allow each merchant to spend the full balance and reconcile later

Rejected. Reconciliation would detect the over-spend after goods had already been released. It
would not protect the beneficiary or the merchant from the loss.

### Use the beneficiary PIN as the account identifier

Rejected. PINs authenticate a selected beneficiary. They are not unique account identifiers. Urban
must resolve the beneficiary through an online name search or another stable identifier before PIN
verification.

### Synchronize stores directly over Bluetooth or local Wi-Fi

Rejected for the first release. Peer-to-peer exchange would need a trusted shared ledger,
authenticated devices, replay protection, conflict resolution, and a secure failure model. It is
not a replacement for centrally allocated permits.

### Let AI decide offline nutrition eligibility

Rejected. AI is an identification aid. The signed catalog and policy release decide eligibility.

### Allow an unlimited number of Rural merchants to hold permits

Rejected. A global seven-merchant cap limits the number of disconnected parties that can hold an
active offline allowance for one beneficiary. The amount invariant still limits the total credit
exposure.

## Implementation constraints

- Additive database migrations only. Never edit an applied migration.
- Mirror every new table and function in `packages/db/src/types.ts` and
  `packages/db/src/types.test.ts`.
- Keep money movement inside Postgres functions with row locks and idempotency.
- Use whole integer credits in signed payment payloads, TypeScript, Kotlin, and SQLite. Use
  `NUMERIC(12,2)` in Postgres and require offline credit amounts to have `.00`. One credit is one
  PHPC and `10^18` PHPC wei. Item-price evidence uses integer centavos.
- Do not add `DB_RECORDED` or `BROADCAST` to the transaction status CHECK.
- Do not place business rules in `apps/web`.
- Ask the owner before applying a migration to a real Supabase project, changing `settle_sale`,
  changing authentication or RLS, adding native crypto/storage dependencies, or deploying.
- Do not commit or push implementation work without an explicit owner request.

## Acceptance conditions

The implementation is not complete until tests show that:

- concurrent reservations across up to seven distinct merchants never exceed the beneficiary's
  unreserved credit;
- only an active admin-approved merchant-beneficiary assignment can provision or reserve credit;
- the seventh distinct merchant may receive a policy-approved permit, but an eighth distinct
  merchant is rejected; multiple devices for one merchant do not consume another merchant slot;
- all active device reservations for one beneficiary and merchant stay within one aggregate
  merchant policy cap;
- online spending cannot consume active offline reservations;
- two offline events cannot consume one reservation twice;
- duplicate events are idempotent;
- one Rural sale ID produces one signed local event across online, offline, timeout, retry, and late
  response paths;
- invalid, expired, revoked, or over-limit events are rejected;
- a permit is valid for at most 30 days, the phone stops sales 24 hours early, and the server uses
  receipt time instead of the device timestamp for expiry;
- the phone warns at seven days and 72 hours, detects clock rollback, and fails closed on a large
  forward clock jump;
- a normal policy update uses the permit-pinned versions, while an emergency revocation creates a
  conflict that needs review;
- five failed offline PIN attempts lock no-card payment until online re-provisioning;
- no-card payment fails closed when any signed amount or event-count limit is missing;
- expiry or release never increments `credit_balance`;
- accepted settlement, final event decision, and its synchronization receipt are committed in one
  Postgres transaction;
- authenticated manual release removes a reservation from the active sum without adding credit;
- both APKs use the shared Branded barcode scanner online, Rural uses it offline, Gemini remains an
  online fallback, and no identifier can override catalog eligibility;
- QR pass version 2 has a minimal payload, uses ES256 without HMAC fallback, checks revocation on
  every pass route, and rotates separately from permit and catalog keys;
- catalog releases are immutable, validated, signed, pinned, and installed atomically;
- offline merchant certificates permit local actions only and never authorize sync, release,
  provisioning, administration, or cash-out;
- conflict review is append-only and any remediation is a separate fully authorized online
  transaction;
- local retention, revocation purge, and device replacement rules preserve pending audit records
  and never copy a private key;
- a signed non-branded commodity can pass deterministic unit and price checks, while an unknown
  commodity is blocked;
- Rural sale records survive app restart and network loss;
- Urban no-card search uses the live backend and never uses a local Rural directory;
- only server-accepted Rural events become cash-outable merchant balance; and
- no GCash, GoTyme, or bank-account payout integration is implemented; those providers remain a
  future partnership plan.

## Reference guides

These sources guide the offline design. BANTAYOG is not a CBDC system, but the BIS documents give
useful controls for offline value, device security, limits, expiry, and later reconciliation.

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
