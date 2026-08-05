# Showcase: Cryptita Plays Builder Showcase @ WOCEE 2026

BANTAYOG enters the Cryptita Plays Builder Showcase. The team presents the built product on the
WOCEE Main Stage. This file holds the event facts. Do not copy the facts into other files. Link
to this file instead.

## Event facts

| Item | Value |
| --- | --- |
| Event | Cryptita Plays Builder Showcase |
| Powered by | WOCEE — WORLDBEX Philippine World Building and Construction Expo — and Museigen.io |
| Co-organizer | GN Club |
| Live show date | August 8, 2026 |
| Venue | SMX Convention Center Manila |
| Prize pool | ₱20,000 |
| Registration form | https://forms.gle/sM5xrP835G7nYLk18 |

## Timeline

| Milestone | Date |
| --- | --- |
| Registration opens | Open now |
| Registration deadline | July 30, 2026 |
| Finalist announcement | August 1, 2026 |
| Live Builder Showcase | August 8, 2026 |

Applications get a screening. The organizers invite the selected finalists to pitch live.

## Category

Submit BANTAYOG under **Bayanihan Finance**. That category covers payments, stablecoins, DeFi,
financial inclusion, OFW remittances and fintech. BANTAYOG moves LGU nutrition money as PHPC
stablecoin credits. It also gives a settlement path to sari-sari store merchants.

Two categories give a secondary fit:

- **Wildcard** — the Gemini vision scan and the grounded price research.
- **Real World** — product identification and eligibility control at the point of sale.

Use a secondary category only if the primary category does not accept the entry.

## Scope for the stage

The showcase is not a hackathon. The organizers ask for work that exists. Do not add features for
the stage. Present the current system:

1. **Admin portal** — beneficiary registration, tier computation and the one-time allocation.
2. **Merchant PWA** — product scan, cart, guardian PIN and checkout through `settle_sale`.
3. **Public balance view** — the printed Nutri-Pass opens a read-only balance page.
4. **Chain settlement** — the outbox table and the reconcile cron record the sale on Stellar Testnet.

## Rules that stay true on stage

- Demo on Stellar Testnet testnet, chain id Testnet. Never wire a mainnet key or a mainnet RPC.
- Use seed or demo records. Never show real beneficiary data, PINs or private keys.
- Keep the demo data in the exact money format: PHP with 2 decimals and integer credits.
- Read the known gaps in `.kiro/steering/security.md` before you answer a judge question about
  security. State the real behaviour, not the aspirational behaviour.

## Related event

SparkFest 2026 (GDG on Campus – Polytechnic University of the Philippines) is the first event for
this project. The team built BANTAYOG for SparkFest. The WOCEE showcase presents the same
codebase. Keep one codebase for both events.
