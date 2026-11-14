-- Draft only. Do not apply to production without isolated integration tests.
-- One transaction: either balance AND all payment confirmations are stored, or none.
CREATE OR REPLACE FUNCTION public.save_account_reconciliation(
  p_betrag numeric, p_erfasst_am timestamptz, p_erfasst_von text,
  p_konto text, p_zahlungen jsonb DEFAULT '[]'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_payment jsonb;
  v_posten public.posten%ROWTYPE;
  v_id uuid;
  v_month date;
  v_paid date;
  v_amount numeric;
  v_timestamp timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_erfasst_von IS DISTINCT FROM (auth.jwt()->>'email') THEN
    RAISE EXCEPTION 'Recorder must match authenticated user';
  END IF;
  IF p_konto NOT IN ('sascha', 'luna') THEN RAISE EXCEPTION 'Invalid account'; END IF;
  IF p_betrag IS NULL OR p_erfasst_am IS NULL THEN RAISE EXCEPTION 'Missing balance or timestamp'; END IF;
  IF jsonb_typeof(p_zahlungen) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid payments'; END IF;
  IF p_konto = 'luna' AND jsonb_array_length(p_zahlungen) > 0 THEN
    RAISE EXCEPTION 'Luna balance cannot confirm Sascha payments';
  END IF;
  -- Validate every item before writing the balance.
  FOR v_payment IN SELECT value FROM jsonb_array_elements(p_zahlungen) LOOP
    v_id := (v_payment->>'posten_id')::uuid;
    v_month := (v_payment->>'finanzmonat')::date;
    v_paid := (v_payment->>'bezahlt_am')::date;
    v_amount := (v_payment->>'betrag')::numeric;
    IF v_id IS NULL OR v_month IS NULL OR v_paid IS NULL OR v_amount IS NULL THEN
      RAISE EXCEPTION 'Incomplete payment';
    END IF;
    v_timestamp := (v_payment->>'erfasst_am')::timestamptz;
    SELECT * INTO v_posten FROM public.posten WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment item not accessible'; END IF;
    IF v_posten.zahlung IS DISTINCT FROM 'konto' THEN RAISE EXCEPTION 'Cash item not allowed'; END IF;
    IF v_amount IS DISTINCT FROM v_posten.betrag THEN RAISE EXCEPTION 'Payment amount changed; reload'; END IF;
    IF v_timestamp IS DISTINCT FROM p_erfasst_am THEN RAISE EXCEPTION 'Timestamp mismatch'; END IF;
  END LOOP;
  INSERT INTO public.kontostaende(betrag,erfasst_am,erfasst_von,konto)
  VALUES (p_betrag,p_erfasst_am,p_erfasst_von,p_konto);
  FOR v_payment IN SELECT value FROM jsonb_array_elements(p_zahlungen) LOOP
    INSERT INTO public.posten_zahlungen(posten_id,finanzmonat,betrag,bezahlt_am,erfasst_am)
    VALUES ((v_payment->>'posten_id')::uuid,(v_payment->>'finanzmonat')::date,
            (v_payment->>'betrag')::numeric,(v_payment->>'bezahlt_am')::date,
            (v_payment->>'erfasst_am')::timestamptz)
    ON CONFLICT (posten_id,finanzmonat) DO UPDATE SET
      betrag=EXCLUDED.betrag, bezahlt_am=EXCLUDED.bezahlt_am, erfasst_am=EXCLUDED.erfasst_am;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.save_account_reconciliation(numeric,timestamptz,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_account_reconciliation(numeric,timestamptz,text,text,jsonb) TO authenticated;
