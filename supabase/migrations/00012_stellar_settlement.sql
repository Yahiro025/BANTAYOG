-- =============================================================================
-- BANTAYOG — Migration 00012: Stellar Settlement Schema
--
-- Adds columns and RPC needed for Stellar-based transaction settlement:
--   1. transactions.asset_amount_stroops (parallel to stablecoin_amount_wei)
--   2. transactions.ledger_sequence (for reconciliation)
--   3. allocations.ledger_sequence (for reconciliation)
--   4. settle_sale_and_enqueue RPC (wraps settle_sale + outbox insert)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ADD asset_amount_stroops to transactions
--    Stores the Stellar asset amount in stroops (1 XLM = 10^7 stroops).
--    TEXT type mirrors the existing stablecoin_amount_wei convention for
--    arbitrary-precision on-chain amounts.
-- -----------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS asset_amount_stroops TEXT;

-- -----------------------------------------------------------------------------
-- 2. ADD ledger_sequence to transactions
--    The Stellar ledger sequence number where the transaction was confirmed.
--    Used by the reconciliation cron (F7) to verify on-chain settlement.
-- -----------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS ledger_sequence INTEGER;

-- -----------------------------------------------------------------------------
-- 3. ADD ledger_sequence to allocations
--    The Stellar ledger sequence number where the allocation was confirmed.
--    Used by the reconciliation cron (F7) to verify on-chain allocation.
-- -----------------------------------------------------------------------------
ALTER TABLE public.allocations
  ADD COLUMN IF NOT EXISTS ledger_sequence INTEGER;

-- -----------------------------------------------------------------------------
-- 4. settle_sale_and_enqueue RPC
--    Wraps the existing settle_sale (which atomically deducts beneficiary credit,
--    credits merchant wallet_balance, and inserts the transaction as CONFIRMED),
--    then immediately updates the transaction status to PENDING_CHAIN and inserts
--    an outbox row for async Stellar settlement.
--
--    The outbox payload includes totalCreditDeducted (= p_amount) so that
--    the reconcile cron's balance-restoration compensator can restore the
--    exact deducted amount on permanent on-chain settlement failure.
--
--    This preserves settle_sale unchanged while extending the flow for Stellar.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_sale_and_enqueue(
  p_beneficiary_id     UUID,
  p_merchant_id        UUID,
  p_amount             NUMERIC(12,2),
  p_items              JSONB,
  p_transaction_id     UUID,
  p_category_totals    JSONB,
  p_asset_amount_stroops TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Step 1: Call existing settle_sale (inserts tx as CONFIRMED, deducts credit,
  --         credits merchant). Raises on any failure, rolling back everything.
  PERFORM public.settle_sale(
    p_beneficiary_id,
    p_merchant_id,
    p_amount,
    p_items,
    p_transaction_id
  );

  -- Step 2: Update the just-inserted transaction to PENDING_CHAIN and record
  --         the Stellar amount in stroops.
  UPDATE public.transactions
    SET status = 'PENDING_CHAIN',
        asset_amount_stroops = p_asset_amount_stroops
    WHERE id = p_transaction_id;

  -- Step 3: Insert outbox row for async Stellar settlement submission.
  INSERT INTO public.outbox (
    kind,
    status,
    attempts,
    payload_jsonb
  ) VALUES (
    'TRANSACTION_CHAIN_SUBMIT',
    'PENDING',
    0,
    jsonb_build_object(
      'transactionId', p_transaction_id,
      'beneficiaryId', p_beneficiary_id,
      'merchantId',    p_merchant_id,
      'amountStroops', p_asset_amount_stroops,
      'categoryTotals', p_category_totals,
      'totalCreditDeducted', p_amount
    )
  );

  RETURN p_transaction_id;
END;
$$;
