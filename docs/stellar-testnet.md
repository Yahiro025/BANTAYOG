# Stellar Testnet Bootstrap

Status: verified on 2026-08-04

This document records public identifiers only. The issuer, distribution, and sponsor secret
keys are stored locally in `apps/server/.env.stellar-testnet.local`, which is ignored by Git and
must not be committed or copied into documentation.

## Network

- Network: Stellar testnet
- Network passphrase: `Test SDF Network ; September 2015`
- Horizon: <https://horizon-testnet.stellar.org>
- Funding: Stellar testnet Friendbot
- Initial distribution target: `100000 PHPC`

## Accounts

| Role | Public address |
| --- | --- |
| Issuer | `GD6YLUSCVJM6R6SZRKUKRMCMHJVNYLKVZM6M2GBGUX32ZJXSXEVI22QQ` |
| Distribution | `GAMOYRHG2FFVDIUR3H2QVT5UFYINGFNRBYVH2QFUOBG6OM6CFVLMFCQ5` |
| Sponsor | `GC5RA2FMNQK5CTXPX5VHF47CNNJYCJWSTVQCJ5GX27L64C4JM332QYES` |

All three accounts were created or loaded by `scripts/bootstrap-stellar.ts` and funded on
Stellar testnet. The sponsor is funded for later fee-bump and reserve work; it is not used by
the Phase 1 bootstrap transactions.

## Asset

- Asset code: `PHPC`
- Issuer: `GD6YLUSCVJM6R6SZRKUKRMCMHJVNYLKVZM6M2GBGUX32ZJXSXEVI22QQ`
- Asset identity: `PHPC:GD6YLUSCVJM6R6SZRKUKRMCMHJVNYLKVZM6M2GBGUX32ZJXSXEVI22QQ`
- Distribution balance: `100000.0000000 PHPC`
- Distribution trustline: authorized
- Distribution trustline: clawback enabled
- Horizon asset records: 1

The issuer account has these flags set:

- `AUTH_REQUIRED`
- `AUTH_REVOCABLE`
- `AUTH_CLAWBACK_ENABLED`

Explorer link: <https://stellar.expert/explorer/testnet/asset/PHPC-GD6YLUSCVJM6R6SZRKUKRMCMHJVNYLKVZM6M2GBGUX32ZJXSXEVI22QQ>

## Bootstrap transactions

| Operation | Transaction hash |
| --- | --- |
| Set issuer flags | `63e3756fdb9ccd2b10a625017f881b059ab7eeac6fbb60fead0a44ba043c2435` |
| Create distribution trustline | `f1ff2313a4fa78cf3f71d6cc8398d974422692b302ed326d265ee641747cacad` |
| Authorize distribution trustline | `30b13c656a316fbd751b8fc08d40fe577d03ed71f8aee38e4109040a5f4f851e` |
| Issue initial PHPC supply | `e6e948b1243bcf97ee66628440d55ee427c640e1618622c9000f521abebf16d0` |

## Reproduction and idempotency

Run from the repository root:

```bash
pnpm bootstrap:stellar
```

The script loads existing local credentials, Friendbots only accounts that are missing from
Horizon, sets only missing issuer flags, creates only a missing trustline, authorizes only an
unauthorized trustline, and issues only the amount needed to reach the initial distribution
target. It can be run again after a testnet reset. Use this command to provision accounts without
asset operations:

```bash
pnpm bootstrap:stellar -- --provision-only
```

Never print or commit the contents of the local credential file. The tracked values in this file
are public addresses and transaction hashes only.
