-- Journal Posting Amount Verification (V1 plan 1.7)
-- Run in Supabase SQL editor after sql/075_enable_ingredients_rls.sql.
--
-- Problem: runPostingPipeline (posting-pipeline.ts) computes debit_base /
-- credit_base and the transaction→base currency conversion entirely in TS,
-- and posting-service.ts inserts the resulting journal_lines / ledger_entries
-- directly into the immutable ledger with no independent server-side check
-- of the arithmetic. The only RPC on this path (allocate_posting_number,
-- sql/064) allocates the posting number, not the amounts. A currency
-- conversion bug or stale client build would silently freeze a wrong
-- financial record with no way to correct it afterwards.
--
-- Note: Posting Rules (which account to debit/credit for a given business
-- event) live only in TS objects (src/features/accounting/rules/*.ts) —
-- there is no posting_rules table. Fully recomputing the proposal
-- server-side (the sql/070-072 tax-engine pattern) would require migrating
-- that whole rules framework into the database first, which is out of
-- scope here. This migration instead re-verifies, independently of the
-- rule that produced them, the two things flagged as risk: the debit/credit
-- balance and the currency conversion arithmetic. It cannot catch a wrong
-- account/rule selection — only a full posting-rules-in-DB migration would.
--
-- Fix: an independent SQL recomputation that, for each proposed journal
-- line, confirms debit_base/credit_base equals the transaction amount
-- converted at the journal's exchange_rate, that exactly one side (debit
-- xor credit) is populated per line, and that the base-currency total is
-- balanced. The service must call this RPC and reject the insert on any
-- mismatch — same verify-before-write shape as sql/065-067 (V1 plan 1.2).
--
-- Additive only:
--   function: verify_journal_posting_amounts(...) -> boolean
--
-- Does NOT:
--   - change journal_entries / journal_lines / ledger_entries schema
--   - perform the insert itself (verification only)
--   - resolve or validate posting rules / account selection

CREATE OR REPLACE FUNCTION verify_journal_posting_amounts(
  p_transaction_currency text,
  p_base_currency text,
  p_exchange_rate numeric,
  p_lines jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_debit_tx numeric;
  v_credit_tx numeric;
  v_debit_base numeric;
  v_credit_base numeric;
  v_sum_debit_base numeric := 0;
  v_sum_credit_base numeric := 0;
BEGIN
  IF p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'Exchange rate must be a positive number.';
  END IF;

  IF p_transaction_currency IS NULL OR p_base_currency IS NULL THEN
    RAISE EXCEPTION 'Transaction and base currency are required.';
  END IF;

  IF p_transaction_currency = p_base_currency AND p_exchange_rate <> 1 THEN
    RETURN false;
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one journal line is required.';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_debit_tx := COALESCE((v_line ->> 'debit_transaction')::numeric, 0);
    v_credit_tx := COALESCE((v_line ->> 'credit_transaction')::numeric, 0);
    v_debit_base := COALESCE((v_line ->> 'debit_base')::numeric, 0);
    v_credit_base := COALESCE((v_line ->> 'credit_base')::numeric, 0);

    IF v_debit_tx < 0 OR v_credit_tx < 0 OR v_debit_base < 0 OR v_credit_base < 0 THEN
      RETURN false;
    END IF;

    -- Exactly one side (debit xor credit) may be populated, consistently
    -- across transaction and base amounts.
    IF (v_debit_tx > 0) = (v_credit_tx > 0) THEN
      RETURN false;
    END IF;
    IF (v_debit_base > 0) = (v_credit_base > 0) THEN
      RETURN false;
    END IF;
    IF (v_debit_tx > 0) <> (v_debit_base > 0) THEN
      RETURN false;
    END IF;

    -- Base amount must equal the transaction amount converted at the
    -- journal's exchange rate — the exact check the TS pipeline never
    -- gets independently verified against today.
    IF round(v_debit_tx * p_exchange_rate, 2) <> v_debit_base THEN
      RETURN false;
    END IF;
    IF round(v_credit_tx * p_exchange_rate, 2) <> v_credit_base THEN
      RETURN false;
    END IF;

    v_sum_debit_base := v_sum_debit_base + v_debit_base;
    v_sum_credit_base := v_sum_credit_base + v_credit_base;
  END LOOP;

  RETURN v_sum_debit_base > 0
    AND round(v_sum_debit_base, 2) = round(v_sum_credit_base, 2);
END;
$$;

-- anon holds its own direct grant on this project independent of PUBLIC
-- membership (see sql/074) — both must be revoked explicitly.
REVOKE ALL ON FUNCTION verify_journal_posting_amounts(text, text, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_journal_posting_amounts(text, text, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION verify_journal_posting_amounts(text, text, numeric, jsonb) TO authenticated;
