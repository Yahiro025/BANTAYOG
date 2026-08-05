# Sol Checkpoint C: Offline Consumption and Sync Authority Review

Date: 2026-08-05

Reviewed revision: `d6fb4c94ab178e5bec542ce4701787688ef6cb32`

Status: **BLOCKED**

Tasks 5 and 7 must not start implementation until findings C-01 through C-05 are resolved. Task 7
also needs owner approval for Kotlin, storage, WorkManager, barcode, OCR, and cryptographic
dependencies. A change to the cash-out lock needs separate owner approval.

## Scope

This review covers:

- one-sale and one-event idempotency;
- fallback decisions for card and no-card sales;
- atomic local permit consumption and event persistence;
- trusted time, process death, retry, retention, and device replacement;
- server decision and receipt rules; and
- the boundary between pending earnings, accepted merchant balance, and online cash-out.

This review does not implement sync, local storage, WorkManager, or cash-out changes.

## Findings

### C-01 — Critical: an identical duplicate is always changed to `ACCEPTED`

`classifyOfflineEventConflict` returns `ACCEPTED` for every identical duplicate. A previously
rejected or conflicting event must return its stored decision and receipt unchanged. The current
input does not contain the original decision.

The documents also conflict about changed replay. One section calls it `CONFLICT`; another calls
it a terminal rejection. Use this first-release rule unless the owner changes the ADR:

- Same idempotency keys and same digest: return the original stored receipt unchanged.
- Reused event, sale, or transaction key with a different digest: terminal `REJECTED` with an
  `IDEMPOTENCY_CONFLICT` reason and no money movement.
- Current emergency revocation on a new otherwise valid event: `CONFLICT` and `Needs review`.

Change the pure contract to accept or return the stored original decision. Do not infer it as
`ACCEPTED`.

### C-02 — Critical: card fallback incorrectly requires a PIN verifier

The fallback function requires a beneficiary verifier for every local event. A valid
`CARD_QR` sale must not need the no-card PIN verifier. A `NO_CARD_PIN` sale must need it.

Required correction:

- Add the authorization method to the fallback input.
- Require a valid PIN verifier only for `NO_CARD_PIN`.
- Require a valid offline QR pass for `CARD_QR`.
- Test every prerequisite separately for both methods.

### C-03 — Important: every HTTP 400 is treated as an image retry

Only a normalized invalid-image response should return `RETRY_CAPTURE`. Another HTTP 400 can mean
an invalid payload, policy failure, or configuration error and must fail closed.

Required correction:

- Add a normalized error code or failure kind for `invalid_image`.
- Return `RETRY_CAPTURE` only for that code or a local image-quality failure.
- Return `BLOCK_POLICY` or `BLOCK_CONFIGURATION` for other HTTP 400 responses.

### C-04 — Critical: sync response invariants are not enforced

The response schema permits `ACCEPTED` without an official transaction ID. It also permits a
rejected result with an official transaction ID. This can make the client display or store an
invalid merchant-balance state.

Required correction:

- `ACCEPTED` requires `officialTransactionId` and the original stable receipt.
- `REJECTED` and `CONFLICT` require no official transaction ID and require a bounded reason code.
- Every result requires a non-null monotonic server cursor after it is stored.

### C-05 — Critical: accepted sync can race with the existing cash-out final update

The current cash-out route reads one wallet balance, performs an external transfer, and later sets
`wallet_balance` to zero. An offline event accepted between those operations can add merchant
balance that the final zero update then deletes.

Recommended correction after owner approval:

- Add a persistent cash-out hold amount or cash-out ledger row.
- In one database transaction, move the exact cash-out amount from available balance to the hold.
- Let later accepted sales add to the remaining available balance.
- On confirmed transfer, clear only the hold. Do not set the current balance to zero.
- On a definite transfer failure, restore the held amount exactly once.
- Keep an indeterminate chain result locked for reconciliation. Do not automatically pay twice.

## Approved local state rules

- Create `saleId` before final confirmation.
- Use `saleId` as the official transaction idempotency key. Remove a separate client-selected
  `transactionId`, or require it to equal `saleId`.
- Create one unique `eventId` and one monotonic `localSequence` per device.
- Sign the complete event before the local commit.
- In one SQLite transaction, verify prerequisites, conditionally decrement remaining permit, and
  insert the immutable event and outbox row.
- A crash before commit changes nothing. A crash after commit leaves one event that can sync.
- Do not delete a pending event because its permit expires after local sale time. Upload it and let
  server receipt time decide.
- Local pending earnings never enter cash-outable balance.

## Required acceptance tests

- [ ] Return the original receipt for identical accepted, rejected, and conflicting duplicates.
- [ ] Reject changed reuse of event ID, sale ID, transaction ID, local sequence, or payload digest
  without moving money.
- [ ] Prove one sale ID, event ID, permit decrement, official transaction, and receipt across
  immediate success, timeout, late response, retry, app kill, restart, and offline queue.
- [ ] Permit card fallback without a PIN verifier when QR, assignment, permit, catalog, and merchant
  certificate checks pass.
- [ ] Require a valid verifier for no-card fallback and enforce five-attempt lock and signed limits.
- [ ] Retry capture only for local image-quality or normalized invalid-image failure.
- [ ] Do not fall back for ineligible, generic 400, 401, 403, invalid signature, invalid catalog,
  invalid policy, or invalid configuration.
- [ ] Prove that event amount in credits equals the signed item total in centavos and that each
  item matches its signed catalog or commodity policy.
- [ ] Test atomic local decrement plus event insert at each crash boundary.
- [ ] Test two concurrent local sale attempts against one remaining permit amount.
- [ ] Test duplicate event, sale, and local-sequence unique constraints after restart.
- [ ] Test seven-day and 72-hour warnings, 24-hour stop, clock rollback, large forward jump, reboot,
  and trusted server-time refresh.
- [ ] Test WorkManager network constraint, ordered upload, bounded batch, exponential retry, and
  stop-on-validation-failure behavior.
- [ ] Prove that a pending event survives permit expiry, process death, and device reboot.
- [ ] Prove that assignment or device revocation purges directory and verifier data but keeps
  pending and Needs Review evidence.
- [ ] Prove that detailed accepted or rejected data expires after 30 days and minimum receipts
  remain for 90 days.
- [ ] Prove that device replacement never exports a private key and does not erase server audit
  evidence.
- [ ] Inject failures before every accepted-event database write. Prove full rollback.
- [ ] Prove that rejected, conflicting, and pending events do not increase `wallet_balance`.
- [ ] Run cash-out and accepted sync concurrently. Prove that the accepted sale remains available
  after the earlier cash-out completes.
- [ ] Prove that a transfer timeout cannot cause an automatic second cash-out.

## Evidence

- Focused Task 1 fallback, reservation, and event tests pass.
- The current tests cover one accepted duplicate only. They do not cover original rejected or
  conflicting receipts.
- The current cash-out route sets the full current wallet balance to zero after external transfer
  confirmation.

