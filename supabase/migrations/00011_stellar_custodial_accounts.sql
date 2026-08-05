-- =============================================================================
-- BANTAYOG — Migration 00011: Stellar Custodial Accounts (Phase 3)
--
-- Option A data cutover: resets demo data for the zero-value testnet migration
-- from Polygon Amoy (EVM) to Stellar/Soroban. Sets up the Stellar custodial
-- account schema with address validation for both classic (G...) and Soroban
-- contract (C...) addresses.
--
-- Changes:
--   1. TRUNCATE EVM-era data (beneficiary_wallets, allocations, transactions)
--   2. NULL out merchants.wallet_address (EVM addresses no longer valid)
--   3. Replace EVM address CHECK on beneficiary_wallets with Stellar pattern
--   4. CREATE merchant_wallets table (mirrors beneficiary_wallets structure)
--   5. ADD Stellar address CHECK on merchants.wallet_address
--   6. RLS on merchant_wallets (admin-only via has_role)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Clear EVM-era data (zero-value testnet, safe to truncate)
--    CASCADE handles FK references from dependent rows.
-- -----------------------------------------------------------------------------
TRUNCATE public.beneficiary_wallets CASCADE;
TRUNCATE public.allocations CASCADE;
TRUNCATE public.transactions CASCADE;

-- -----------------------------------------------------------------------------
-- 2. Reset merchant wallet addresses (EVM addresses are now invalid)
-- -----------------------------------------------------------------------------
UPDATE public.merchants SET wallet_address = NULL;

-- -----------------------------------------------------------------------------
-- 3. Replace EVM address constraint on beneficiary_wallets
--    Old: '^0x[0-9a-fA-F]{40}$' (Ethereum 20-byte hex)
--    New: '^[GC][A-Z2-7]{55}$'  (Stellar public key G... or Soroban contract C...)
-- -----------------------------------------------------------------------------
ALTER TABLE public.beneficiary_wallets
  DROP CONSTRAINT IF EXISTS beneficiary_wallets_address_check;

ALTER TABLE public.beneficiary_wallets
  ADD CONSTRAINT beneficiary_wallets_address_check
    CHECK (address ~ '^[GC][A-Z2-7]{55}$');

-- -----------------------------------------------------------------------------
-- 4. CREATE merchant_wallets
--    One-to-one with merchants. Mirrors beneficiary_wallets structure.
--    Key material stored only as AES-256-GCM ciphertext (never plaintext).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_wallets (
    merchant_id      UUID PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
    address          TEXT NOT NULL UNIQUE CHECK (address ~ '^[GC][A-Z2-7]{55}$'),
    enc_ciphertext   TEXT NOT NULL,
    enc_iv           TEXT NOT NULL,
    enc_auth_tag     TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 5. ADD Stellar address constraint on merchants.wallet_address
--    Column is nullable, so NULL passes the CHECK automatically.
-- -----------------------------------------------------------------------------
ALTER TABLE public.merchants
  DROP CONSTRAINT IF EXISTS merchants_wallet_address_stellar_check;

ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_wallet_address_stellar_check
    CHECK (wallet_address ~ '^[GC][A-Z2-7]{55}$');

-- -----------------------------------------------------------------------------
-- 6. Index on merchant_wallets.address for lookup performance
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_merchant_wallets_address
    ON public.merchant_wallets(address);

-- -----------------------------------------------------------------------------
-- 7. RLS on merchant_wallets
--    Convention from migration 00001/00003: has_role() helper, admin_all_* policy.
--    Services access via service role key (bypasses RLS).
-- -----------------------------------------------------------------------------
ALTER TABLE public.merchant_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_merchant_wallets ON public.merchant_wallets
    FOR ALL USING (public.has_role('admin'))
    WITH CHECK (public.has_role('admin'));

-- =============================================================================
-- Done. Stellar custodial account schema ready:
--   - EVM data cleared
--   - beneficiary_wallets accepts Stellar addresses
--   - merchant_wallets table created with RLS
--   - merchants.wallet_address validated for Stellar format
-- =============================================================================
