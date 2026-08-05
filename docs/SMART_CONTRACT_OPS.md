# Smart Contract Operations Guide (Superseded)

**Status: superseded.** BANTAYOG migrated from a Polygon Amoy smart-contract chain layer to
Stellar classic assets (see `docs/adr/004-stellar-migration.md`). `packages/contracts` (the
Solidity `PHPCSubsidy`/`PHPC`/`BeneficiaryRegistry`/`MerchantRegistry` package this document
described) has been deleted as part of that migration's Phase 7 teardown. There is no on-chain
contract to compile, deploy, or upgrade anymore.

This document is retained only as a historical pointer. For the current Stellar operations
equivalent, see below.

## Current Stellar operations

PHPC is now a classic Stellar asset with issuer flags (`AUTH_REQUIRED`, `AUTH_REVOCABLE`,
`AUTH_CLAWBACK_ENABLED`) rather than a bespoke bookkeeping contract, so there is no proxy,
storage layout, or upgrade procedure to manage.

**Asset bootstrap** (issuer/distribution/sponsor account creation, issuer flags, initial supply):
```bash
pnpm bootstrap:stellar
```
Idempotent and safe to re-run, including after a Stellar testnet reset. See
`scripts/bootstrap-stellar.ts` and `docs/stellar-testnet.md` for the recorded addresses,
transaction hashes, and explorer links.

**Beneficiary/merchant account re-provisioning** (account creation, PHPC trustline, issuer
authorization for existing rows, e.g. after a testnet reset):
```bash
pnpm provision:stellar
```
See `scripts/provision-stellar-accounts.ts`.

**Configuration**: Stellar environment variables (`STELLAR_HORIZON_URL`,
`STELLAR_NETWORK_PASSPHRASE`, `PHPC_ASSET_CODE`, `PHPC_ISSUER_PUBLIC_KEY`, `PHPC_ISSUER_SECRET`,
`PHPC_DISTRIBUTION_SECRET`, `STELLAR_SPONSOR_SECRET`) are validated together by
`apps/server/src/lib/chain/config.ts`'s `loadChainConfig`. See the root `.env.example` and
`apps/server/.env.example` for the full variable set.

**Freeze and clawback**: Available via the issuer flags set at bootstrap
(`AUTH_REVOCABLE`/`AUTH_CLAWBACK_ENABLED`), operable manually with the issuer key. There is
currently no admin UI for this; see the runbook's "Explicitly out of scope" section.
