# Sol Checkpoint A: Database Authority Review

Date: 2026-08-05

Reviewed revision: `d6fb4c94ab178e5bec542ce4701787688ef6cb32`

Status: **BLOCKED**

Task 2 must not start implementation until findings A-01 and A-02 are corrected in the frozen
Task 1 rules. The owner must also approve the migration, `settle_sale`, authentication, and RLS
gates before Task 2 changes those areas.

## Scope

This review covers:

- the Task 1 offline credit schemas and pure reservation rules;
- the Task 2 SQL transaction boundary;
- integer-credit math;
- assignment, reservation, and seven-merchant invariants;
- idempotency, RLS, and `SECURITY DEFINER` controls; and
- concurrency and rollback tests.

This review does not implement a migration or change production code.

## Findings

### A-01 — Critical: invalid negative reservation state can increase available credit

`computeAvailableOfflineCredits` adds every supplied amount without rejecting a negative value.
`canIssueOfflineReservation` also adds negative values to the merchant aggregate. A caller bug or
data defect can therefore make the pure reference authorize more than the beneficiary balance.

Required correction:

- Reject a negative beneficiary balance.
- Reject a negative active remaining amount.
- Reject a non-positive merchant policy cap.
- Keep the existing rejection of a non-positive requested amount.
- Add tests that prove invalid state fails closed.
- Add matching SQL `CHECK` constraints and RPC argument checks.

### A-02 — Important: the pure rule cannot apply an approved merchant limit below seven

ADR-004 allows policy to use fewer than seven active Rural merchants. The pure issuance input has
only the fixed maximum of seven. Task 2 must not create a separate SQL-only interpretation.

Required correction:

- Add `maximumActiveRuralMerchants` to the pure issuance input.
- Accept only an integer from 1 through 7.
- Apply the policy value before a new distinct merchant receives a reservation.
- Add tests for policy limits of 1, 3, and 7.

### A-03 — Critical: new privileged RPCs need explicit execute grants

The planned SQL functions move money and create or release authorization. RLS is not sufficient
for a `SECURITY DEFINER` function.

Required Task 2 controls:

- Set a fixed safe `search_path` on every privileged function.
- Revoke `EXECUTE` from `PUBLIC`, `anon`, and `authenticated` unless a function is intentionally
  exposed to that role.
- Grant only the minimum service or administrator role.
- Keep route ownership and role checks because the API service role bypasses RLS.
- Test direct unauthorized RPC calls.

### A-04 — Critical: all money paths need one lock order

Reservation issue, release, online settlement, offline settlement, and expiry can touch the same
beneficiary and reservation rows. Different lock orders can deadlock or allow a stale check.

Required lock order:

1. Claim or resolve the idempotency record without moving money.
2. Lock the beneficiary row.
3. Lock the assignment and reservation rows in stable ID order.
4. Lock the merchant row only when money will move.
5. Perform all checks and writes in one database transaction.

The implementation must document and use the same order in each RPC.

### A-05 — Critical: online settlement must subtract active reservations under the same lock

The current `settle_sale` checks only `credit_balance`. Task 2 must replace that check with the
unreserved amount while it holds the beneficiary row lock. It must not calculate the sum in
TypeScript.

## Approved SQL invariants

Task 2 must enforce all of these invariants:

```text
requested_credits is a whole positive credit amount
maximum_credits and remaining_credits are whole non-negative credit amounts
remaining_credits <= maximum_credits
expires_at > issued_at
expires_at <= issued_at + 30 calendar days
available = credit_balance - sum(active remaining_credits)
available >= requested_credits
active distinct Rural merchant IDs with remaining_credits > 0 <= policy limit <= 7
sum(active remaining for beneficiary and merchant) + requested <= merchant policy cap
online spend <= credit_balance - sum(active remaining_credits)
release and expiry never increase credit_balance
```

## Required acceptance tests

- [ ] Reject negative balances, reservation amounts, caps, and remaining amounts in pure rules and
  SQL.
- [ ] Reject fractional offline credits at every RPC boundary.
- [ ] Prove the 1,000-credit example: reservations of 300 and 200 leave 500; 501 is rejected.
- [ ] Run two concurrent issuance calls whose total exceeds the available credit. Prove that the
  committed total does not exceed the balance.
- [ ] Allow the seventh distinct merchant and reject the eighth.
- [ ] Prove that two devices for one merchant use one merchant slot and one aggregate cap.
- [ ] Enforce an approved lower merchant limit of 1 or 3.
- [ ] Reject an absent, expired, revoked, wrong-merchant, or self-approved assignment.
- [ ] Prove that a merchant cannot choose its own reservation amount.
- [ ] Prove that an online sale cannot spend an active offline reservation.
- [ ] Prove that server receipt time, not device time, controls event expiry.
- [ ] Prove that expiry and owner or administrator release do not change `credit_balance`.
- [ ] Record release actor, reason, and server time. Prove that repeat release is idempotent.
- [ ] Inject a failure before sync receipt insertion. Prove that all accepted-event writes roll
  back.
- [ ] Prove that one successful accepted-event RPC commits reservation consumption, beneficiary
  deduction, merchant credit, official transaction, final decision, and receipt together.
- [ ] Prove that rejected and conflicting events store audit evidence without moving money.
- [ ] Prove that unauthorized database roles cannot execute privileged RPCs.
- [ ] Run a repeated concurrency test with issuance, release, online settlement, and offline
  settlement. Confirm that no deadlock or over-reservation occurs.
- [ ] Mirror all tables, rows, and functions exactly in `packages/db/src/types.ts` and its tests.

## Evidence

- Schema tests: 120 passed.
- Focused server domain tests: 57 passed.
- Repository type-check: 7 tasks passed.
- Repository lint: failed because ESLint scanned generated files in `apps/web/out`. This failure is
  outside the Task 1 source files, but it remains an unresolved repository gate.

