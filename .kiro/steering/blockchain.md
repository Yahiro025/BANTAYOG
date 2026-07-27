---
inclusion: manual
---

# Blockchain (Polygon Amoy + PHPC)

Single target network: **Polygon Amoy testnet, chain id 80002**. The former Ronin/Saigon stack was
removed by the `polygon-amoy-phpc-migration` work and a static test enforces that it stays gone.

## Contracts (`packages/contracts/contracts`)

- `PHPC.sol` — mock PHP-pegged ERC-20 (the subsidy unit; 18 decimals, 1 credit = 1 PHPC).
- `PHPCSubsidy.sol` — UUPS-upgradeable subsidy logic; `onlyOwner` on `allocateCredits` and
  `processTransaction`; uses the transaction UUID as an on-chain de-duplication key.
- `BeneficiaryRegistry.sol`, `MerchantRegistry.sol` — registries retained from the earlier design;
  addresses are still read by `apps/web` but they are not part of the PHPC settlement path.
- `UUPSProxy.sol`, `test/PHPCSubsidyV2Mock.sol` — proxy plumbing and upgrade-path test fixture.

Hardhat 3 config: solc 0.8.28, optimizer runs 200, `evmVersion: london`, networks `hardhat`
(`edr-simulated`, 31337, unit tests only) and `amoy` (`http`, 80002). Upgrade runbook is in
`docs/SMART_CONTRACT_OPS.md`; keep V2 storage layouts identical to V1.

## Server-side chain layer

- `src/lib/chain/config.ts` — `loadChainConfig(env)` is the single entry point. It validates
  `POLYGON_AMOY_RPC_URL` (http/https, non-localhost), `DEPLOYER_PRIVATE_KEY` (0x + 64 hex),
  `LGU_ADMIN_WALLET_ADDRESS`, `PHPC_TOKEN_ADDRESS`, `PHPC_SUBSIDY_ADDRESS`,
  `CUSTODIAL_KEY_ENCRYPTION_KEY`, `QR_TOKEN_SECRET`, optional `QR_TOKEN_TTL_SECONDS`
  (positive int, default 300). It reports *all* offending variables in one `ValidationError` and
  never returns a partial config.
- `src/services/chain.client.ts` — `BlockchainClient.create(config)` wraps viem public/wallet
  clients: `transferPHPC`, `allocateCredits`, `getBalance`, `waitForConfirmation`. All methods
  return `AppResult`; RPC failures surface as `OnchainError` (→ HTTP 502).
- `src/services/custodial-wallet.service.ts` — generates a per-beneficiary EVM keypair and stores
  the private key only as AES-256-GCM ciphertext keyed by `CUSTODIAL_KEY_ENCRYPTION_KEY`.
- `src/services/event-listener.ts` — deliberately disabled; the reconcile cron supersedes it. The
  server entry still calls `startChainEventListener`, which logs and no-ops.
- `src/services/wallet-adapter.gateway.ts` — verifies EIP-1193 / `personal_sign` proofs for
  merchant wallet login and wallet connect.

## Settlement model (ADR-001)

1. Checkout is settled **off-chain first** via `settle_sale`: beneficiary credit down, merchant
   `wallet_balance` up, transaction row `CONFIRMED`. The merchant sees an instant result.
2. On-chain movement happens later:
   - `POST /api/cron/reconcile` drains `TRANSACTION_CHAIN_SUBMIT` outbox rows and transfers PHPC
     from the treasury/deployer wallet to the merchant wallet (a plain transfer today, not the
     subsidy contract's atomic `processTransaction` — flagged as a TODO in `cron/reconcile.ts`).
   - Merchant cash-out transfers the accumulated `wallet_balance` on demand.
3. Failure handling: up to 3 attempts, then outbox `FAILED`, transaction `FAILED`, and
   `TransactionService.restoreBeneficiaryBalance` writes a `BALANCE_RESTORATION_AUDIT` outbox row
   plus an error log. With the current ordering the balance is never deducted before confirmation
   on the live path, so this compensator is a safety net for legacy/future deduct-then-settle
   paths.
4. `transaction.machine.ts` (XState) documents the intended lifecycle
   `IDLE → VALIDATING → PENDING_CHAIN → SUBMITTED → CONFIRMED → RECONCILED` with `FAILED` as a
   terminal branch. It is descriptive; the routes do not currently drive it.

## Amount conversions

- 1 credit = 1 PHPC = 1e18 wei. `TransactionService` computes
  `BigInt(totalCreditDeducted) * 10n**18n` (integer credits only).
- Cash-out preserves centavos: `BigInt(Math.round(amount * 100)) * 10n**16n`.
- Allocations: Tier 1 = 5,000 PHPC, Tier 2 = 3,500 PHPC; `beneficiary.service.ts` waits up to 60s
  (`ALLOCATION_CONFIRMATION_TIMEOUT_MS`) for confirmation, while `chain.client.ts` uses a 30s
  default RPC/receipt timeout (`OPERATION_TIMEOUT_MS`). Cash-out passes an explicit 300s.
- `QR_TOKEN_TTL_SECONDS` is validated by `loadChainConfig` (default 300) but `QrTokenService`
  ignores it — QR tokens carry no `exp`. Expiry lives in `qr_passes.expires_at`.

## Keys

`DEPLOYER_PRIVATE_KEY` doubles as deployer and treasury signer. It is a zero-value Amoy testnet
key and must never leave the server boundary; `apps/web/lib/env.ts` falls back to Hardhat's
well-known account #0 for local dev only. Never introduce a mainnet key or mainnet RPC.
