# ADR 004: Migration from Polygon Amoy to Stellar

Status: accepted, not yet implemented. Supersedes the chain layer described in ADR 001.

## Context

BANTAYOG currently settles on Polygon Amoy testnet using a mock PHPC ERC-20 and an
upgradeable `PHPCSubsidy` (UUPS) contract. A code audit of the chain layer found three
problems that are structural rather than incidental:

1. **Purchases never reach the chain.** The live checkout route calls the `settle_sale`
   RPC and returns. It inserts no outbox row. `TransactionService.createTransaction`,
   the only code that inserts a `TRANSACTION_CHAIN_SUBMIT` row, is reachable only from
   tests. The reconcile cron therefore always finds zero rows, and
   `PHPCSubsidy.processTransaction` has no production callers.
2. **Funds are stranded.** `allocateCredits` moves PHPC into the `PHPCSubsidy` contract,
   but merchant payouts are sent from the deployer wallet. The contract has no withdraw
   path other than `processTransaction`, which is never called, so allocated tokens
   accumulate in a contract they cannot leave while the payout wallet drains separately.
3. **The on-chain ledger only increments.** `beneficiaryBalance` is credited by
   `allocateCredits` and never debited, because the only debit path is the uncalled
   `processTransaction`. On-chain balances diverge permanently from Postgres.

Problems 2 and 3 exist because balance bookkeeping was reimplemented in Solidity.
Separately, the merchant app ships as a Capacitor Android WebView, which makes
browser-extension wallets unavailable, and per-transaction gas on an EVM chain forces a
tradeoff between traceability and cost at any real volume.

## Decision

Migrate the entire chain layer to Stellar, using **classic Stellar assets** rather than
Soroban contracts for the MVP.

Stellar's native accounts and trustlines replace `PHPCSubsidy` in full. A per-beneficiary
balance mapping is a native account balance; crediting and debiting it are native payment
operations. There is no contract to write, and problems 2 and 3 above become structurally
impossible because there is no custom bookkeeping to get wrong. Stellar debits the sender
natively.

### D1: Classic assets, not Soroban (MVP scope)

PHPC becomes a classic Stellar asset issued by an LGU issuing account. Policy control
comes from issuer flags rather than contract code:

| Flag | Purpose |
| --- | --- |
| `AUTH_REQUIRED` | Only LGU-authorized trustlines may hold PHPC |
| `AUTH_REVOCABLE` | The LGU can freeze a holder's balance |
| `AUTH_CLAWBACK_ENABLED` | The LGU can reclaim misused subsidies |

Nothing in the current requirements needs custom on-chain logic. This is balance tracking
and transfers, which the above covers natively with no contract to write or audit.
Soroban is deferred to Phase 8, not ruled out. See "Phase 8" below.

### D2: Beneficiary pays the merchant directly

Purchase settlement is a single payment operation from the beneficiary's account to the
merchant's account, submitted asynchronously by the outbox worker and fee-bumped by the
LGU sponsor account. The beneficiary genuinely holds and spends the asset, which is what
makes the audit trail real. This also gives `CustodialWalletService` a purpose; today it
generates and encrypts beneficiary keys that never sign anything because `signAndSend`
has no callers.

Postgres remains the source of truth for UX. `settle_sale` is unchanged, so the merchant
still gets an instant result at the counter and the chain leg stays off the request path.

### D3: Cash-out becomes read-only

Because merchants receive real PHPC per purchase, `merchants.wallet_balance` stops being
a custodial liability. The existing cash-out screen is retained but repointed to display
the merchant's live on-chain PHPC balance read from Horizon. The `cashout_in_progress`
lock is dropped, as there is no longer a custodial sweep to serialize.

### D4: Merchants are custodial too

Merchants receive generated Stellar keypairs encrypted at rest under the same
`CustodialWalletService` pattern as beneficiaries, with the LGU fee-bumping their
transactions. There is no Freighter dependency and no proof-of-ownership flow.
Merchants continue to log in with mobile number and password. The wallet-connect endpoint
and the wallet-signature login route are deleted.

## Migration phases

### Phase 0 — Prep

Run `pnpm install` (the repo currently has no `node_modules`) and get the existing suite
green as a baseline, so migration breakage is distinguishable from pre-existing breakage.
Create the Stellar testnet issuing, distribution, and sponsor accounts via friendbot.
Record the new environment variable set.

Environment variables added:

```
STELLAR_HORIZON_URL
STELLAR_NETWORK_PASSPHRASE
PHPC_ASSET_CODE
PHPC_ISSUER_PUBLIC_KEY
PHPC_ISSUER_SECRET
PHPC_DISTRIBUTION_SECRET
STELLAR_SPONSOR_SECRET
```

Removed: `POLYGON_AMOY_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `LGU_ADMIN_WALLET_ADDRESS`,
`PHPC_TOKEN_ADDRESS`, `PHPC_SUBSIDY_ADDRESS`, `BENEFICIARY_REGISTRY_ADDRESS`,
`MERCHANT_REGISTRY_ADDRESS`. Retained unchanged: `CUSTODIAL_KEY_ENCRYPTION_KEY`,
`QR_TOKEN_SECRET`.

### Phase 1 — Asset bootstrap

Replace `packages/contracts/scripts/deploy.ts` with `scripts/bootstrap-stellar.ts`:
issue PHPC, set the three issuer flags, fund the distribution account. The script must be
idempotent and re-runnable, because Stellar testnet resets periodically and wipes all
accounts, assets, and trustlines.

Exit criteria: PHPC visible on Horizon testnet with the correct flags set.

### Phase 2 — Config and client

Rewrite `lib/chain/config.ts` for Stellar variables and `services/chain.client.ts` as a
`StellarClient`. The `AppResult` / `OnchainError` contract is preserved exactly, keeping
the blast radius inside the chain layer. Port the existing config tests, which are sound
and mostly need new variable names.

The client exposes **intent-shaped** methods, not operation-shaped ones. See F2 below.

### Phase 3 — Custodial accounts (both roles)

Swap `viem/accounts` for Stellar `Keypair` (ed25519). The AES-256-GCM storage, SHA-256 key
derivation, buffer zeroization, and collision-retry logic in `CustodialWalletService` all
carry over unchanged. Generalize the service to provision both beneficiary and merchant
accounts: create account with sponsored reserve, create trustline, authorize trustline.
Beneficiary provisioning happens at registration; merchant provisioning at approval.

New migration: change the address CHECK constraint from `^0x[0-9a-fA-F]{40}$` to a
Stellar-compatible pattern. See F5 below for the exact pattern.

### Phase 4 — Allocation

Rework `allocateTierCredits` to pay PHPC from distribution to the beneficiary account.
This deletes the two-transaction transfer-then-allocate sequence, the manual nonce
arithmetic, the hardcoded gas limits, and the six `console.log` calls that bypass pino
redaction. Tier amounts (Tier 1 = 5,000; Tier 2 = 3,500) and the one-time
`allocations.beneficiary_id UNIQUE` idempotency guard are unchanged.

### Phase 5 — Purchase settlement

This phase also fixes problem 1 from the Context section.

`settle_sale` is unchanged. Add the missing `TRANSACTION_CHAIN_SUBMIT` outbox insert to
the live checkout route. Rewrite the reconcile worker to submit a fee-bumped
beneficiary-to-merchant payment. Convert amounts to integer stroops at 7 decimals.
Add the missing `qr_passes.revoked` check to the checkout route and the balance view while
in that code.

### Phase 6 — Merchant surface

Delete `POST /api/merchants/me/wallet` and the wallet-signature login route. Rewrite
`wallet-adapter.gateway.ts` or delete it, per D4. Repoint `GET /api/merchants/me` to read
the live on-chain PHPC balance from Horizon. Stop writing `cashout_in_progress`.

### Phase 7 — Teardown

Delete `packages/contracts`, `apps/web/lib/chain/*`, and the dead chain-write code in
`apps/web/lib/services/{beneficiary,merchant}.service.ts`. Drop viem, Hardhat, and
OpenZeppelin. Repoint `static-checks/forbidden-references.test.ts` at EVM terms so the
migration cannot silently regress. Update `turbo.json` `globalEnv`, the three
`.env.example` files, `packages/db/src/types.ts`, README, and ADR 001.

## Phase 8 — Soroban migration (roadmap, not MVP)

Soroban is a planned phase, deferred for time-to-demo reasons rather than rejected.

### The bridge: Stellar Asset Contract

A classic Stellar asset can be wrapped as a Stellar Asset Contract (SAC), which gives
Soroban contracts the ability to transfer it. **The asset does not need to be reissued and
holders do not need new trustlines.** This is what makes Phase 8 additive rather than a
migration: the PHPC issued in Phase 1 is the same PHPC a Soroban contract moves in Phase 8.
Choosing classic assets for the MVP does not lock us out.

### What genuinely belongs in a contract

Programmable, stateful, conditional logic that the LGU wants publicly auditable rather
than trusted to our server:

| Candidate | Why it is contract-shaped |
| --- | --- |
| **Category spending caps** | "At most N% of a grant on `SNACKS`", per-category ceilings. Stateful, per-beneficiary, evaluated per purchase. This is the literal mechanism behind "nutrition-locked" and currently lives entirely in server trust. |
| **Tier eligibility window** | `computeTier` is a pure function of dates. Expressible against `ledger.timestamp()` plus a stored conception date, making the RA 11148 1,000-day rule publicly verifiable instead of server-asserted. |
| **Expiring subsidies** | Unspent credits return to the treasury once the beneficiary's 1,000-day window closes. Genuine policy logic, time-dependent, currently unimplemented anywhere. |
| **Spending velocity limits** | Max transactions per day, max value per transaction, anti-collusion limits between one beneficiary and one merchant. Stateful and per-period. |
| **One-time allocation guard** | Today a Postgres UNIQUE constraint. On-chain it becomes a contract-enforced invariant that does not depend on trusting our database. |
| **Merchant settlement holdback** | Withhold merchant funds for N days pending audit, releasable or clawback-able by the LGU. |

### What must NOT move to a contract

Stating this explicitly, because the failure mode of a Soroban phase is putting things
on-chain that do not belong there:

- **Multi-approver disbursement.** Stellar classic already does this natively via multisig
  thresholds and signer weights on the distribution account. Do not reimplement it in a
  contract.
- **Freeze and clawback.** Already covered by the Phase 1 issuer flags.
- **Plain transfers.** Classic payment operations are cheaper than a contract invocation.
- **Product catalog and vision results.** Too much mutable data; off-chain by nature.
  ADR 003's separation stands.
- **Guardian PIN and PII.** Never on-chain, in any phase.

### Which Phase 4 and Phase 5 operations change

**Phase 4 allocation.** Classic: a `payment` operation from distribution to the
beneficiary, with the tier amount computed in TypeScript. Soroban: an
`invoke_host_function` call to `SubsidyProgram.allocate(beneficiary, tier)`, where the
contract derives the amount from on-chain tier rules, enforces the one-time guard, and
moves PHPC via the SAC. The server stops choosing the amount.

**Phase 5 settlement.** Classic: a `payment` operation from beneficiary to merchant,
fee-bumped. Soroban: an `invoke_host_function` call to
`SubsidyProgram.spend(beneficiary, merchant, amount, category)`, where the contract checks
category caps, velocity limits, and the tier window before performing the SAC transfer,
and rejects the invocation if any check fails. The outbox worker's structure is unchanged;
only the operation it builds differs.

Fee-bump wrapping works on any transaction, including one containing an
`invoke_host_function` operation, so the sponsor design carries forward untouched.

## Forward-compatibility notes for Phases 0 through 7

Places where a classic-asset-only build would make Phase 8 harder, with the cheap
mitigation available now. None of these add Soroban complexity to the MVP.

**F1. Authorize contract addresses under `AUTH_REQUIRED`.** With `AUTH_REQUIRED` set,
every PHPC holder needs an authorized trustline, and in Phase 8 that includes the
contract's own address (`C...`). Cost now: zero. Just be aware that Phase 8 includes an
authorization step for the contract, and do not treat "only `G...` addresses hold PHPC"
as an invariant.

**F2. Make `StellarClient` methods intent-shaped, not operation-shaped.** Highest-value
item on this list. Prefer `settlePurchase(beneficiaryId, merchantId, amountStroops,
categoryTotals)` and `allocateSubsidy(beneficiaryId, tier)` over `payPHPC(from, to,
amount)`. The classic payment operation becomes an implementation detail inside the
method. Phase 8 then swaps method bodies without touching a single caller. Cost now:
naming plus one or two extra parameters that the classic path ignores.

**F3. Keep the outbox payload semantic, and add category totals.** The payload must
describe *what happened* (`transactionId`, `beneficiaryId`, `merchantId`,
`amountStroops`, per-category totals), never a pre-built serialized XDR operation. If it
stores an operation, every queued row breaks on the Phase 8 cutover. The current payload
is already semantic; add category totals now so the contract's future inputs are already
being captured. Cost now: a few fields.

**F4. Pass `tier`, not a pre-resolved amount, across the chain boundary.** Today
`beneficiary.service.ts` computes `tier === 1 ? 5000 : 3500` and passes the amount. In
Phase 8 the contract derives the amount from the tier. Move the tier-to-amount mapping
inside the chain layer now so the boundary already matches the future contract signature.
Cost now: moving three lines.

**F5. Use an address CHECK constraint that accepts contract addresses.** Soroban contract
addresses are `C` followed by 55 base32 characters, the same shape as `G` account
addresses. A constraint of `^G[A-Z2-7]{55}$` will reject them and force a future
migration. Use `^[GC][A-Z2-7]{55}$` in the Phase 3 migration instead. Cost now: one
character in a regex.

**F6. Do not hardcode the fee as a constant.** Classic operations are a flat 100 stroops.
Soroban transactions add resource fees for CPU, memory, and ledger writes, computed by
simulating the transaction first. Expose the fee as a value the client computes rather
than a module-level constant, so Phase 8 does not require finding every hardcoded
assumption. Cost now: one function instead of one constant.

**F7. Record the ledger sequence alongside the transaction hash.** Useful for
reconciliation in both phases and cheap to capture at write time. Cost now: one column.

**F8. Expect a simulation step in the status lifecycle.** Soroban submission requires
simulating to obtain the resource footprint before signing. The existing
`PENDING_CHAIN` status absorbs this, so no schema change is needed now; noted so the
lifecycle is not designed in a way that forbids an extra pre-submission step.

## Consequences

### Benefits

- Deleting `PHPCSubsidy` removes the stranded-funds bug and the one-way-ledger bug by
  construction, rather than patching them.
- Fees become fixed and negligible per operation, so every purchase can be settled
  on-chain individually without the Merkle-batching workaround an EVM chain would need.
- Fee-bump and sponsored reserves mean neither merchants nor guardians ever hold XLM or
  manage sequence numbers, matching the product constraint that guardians have no
  smartphone budget and merchants use low-end Android devices.
- Clawback and revocable authorization give the LGU real policy enforcement that the
  Solidity version could not express.
- The custodial model removes the Capacitor-versus-browser-extension wallet problem
  entirely.

### Costs and risks

- **R1. Trustlines are a new failure mode.** On EVM any address can receive any ERC-20.
  On Stellar an account cannot receive PHPC without an authorized trustline to the issuer,
  and payment to an account without one fails. Every payment path needs a trustline
  pre-check with a clear error, and both onboarding flows need a trustline step. This has
  no equivalent in the current code and is the easiest thing to miss.
- **R2. Testnet resets** wipe all accounts, assets, and trustlines periodically. The
  Phase 1 bootstrap must be idempotent and a re-provisioning path is needed for existing
  beneficiary and merchant rows. Do not schedule a demo immediately after a reset.
- **R3. Sequence numbers are stricter than nonces.** Concurrent submissions from one
  source account collide. The outbox worker already processes rows serially, so a single
  source account suffices for the MVP; channel accounts are the fix if it is parallelized.
- **R4. Seven decimals, not eighteen.** Every `10n ** 18n` and the
  `BigInt(Math.round(amount * 100)) * BigInt(10 ** 16)` in cash-out is reworked to integer
  stroops. Postgres stays `NUMERIC(12,2)`. Because migrations are append-only,
  `transactions.stablecoin_amount_wei` gains a stroops sibling column rather than a rename.
- **R5. Custodial merchant keys widen the blast radius** of a
  `CUSTODIAL_KEY_ENCRYPTION_KEY` compromise from beneficiaries to merchants as well.
  Acceptable for a testnet MVP with zero-value assets; revisit before any mainnet use.
- **R6. Narrative change.** "We wrote a smart contract" becomes "we used native asset
  primitives, with Soroban on the roadmap." Phase 8 above exists partly to make that
  roadmap concrete.
