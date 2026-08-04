there's# ADR 001: Transactional Outbox Pattern for Blockchain Submissions

## Context

BANTAYOG processes redemption transactions that must be recorded both in the off-chain Supabase database and settled on-chain on the Ronin blockchain (PHPC stablecoin transfer).

Blockchain transactions are subject to network congestion, RPC latency, gas volatility, and transient timeouts. Performing on-chain write operations synchronously within the merchant's HTTP request lifecycle leads to:
1. Long HTTP response times (making the app feel slow and unresponsive).
2. Risk of partial completion (e.g., database updates succeed but blockchain call times out, causing database/chain state drift).
3. Lack of auto-retry capability on block re-orgs or RPC connection drops.

## Decision

We will implement the **Transactional Outbox Pattern** to process blockchain settlements:
1. When a transaction is submitted, the API handler writes both the transaction record (status: `PENDING_CHAIN`) and an event payload into the `outbox` table within a single, atomic PostgreSQL transaction.
2. A separate reconciliation cron worker polls the `outbox` table for pending events, signs and submits the corresponding transaction on-chain via the `ChainClient`, and monitors block receipts.
3. Once the transaction receipt confirms success, the outbox entry is marked as `DONE` and the transaction status is updated to `CONFIRMED`.

## Consequences

### Benefits
- **Reliability**: Eliminates database-chain drift. If the blockchain submission fails, the outbox entry remains in `PENDING` status for subsequent retries.
- **Performance**: Merchant HTTP requests complete instantly, returning a `201 Created` status showing `PENDING_CHAIN` on checkout completion.
- **Idempotency**: The blockchain contract uses the unique transaction UUID hash as a de-duplication key. If the cron worker crashes and restarts, it cannot cause double-spend on-chain.

### Drawbacks
- **Delayed Settlement**: On-chain confirmation is deferred until the cron worker runs, creating a small delay (typically under 1 minute) for transactions to settle.
