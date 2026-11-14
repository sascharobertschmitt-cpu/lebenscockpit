-- ROLLBACK von Migration 2/2. NICHT automatisch ausfuehren (liegt bewusst ausserhalb von supabase/migrations).
-- Vorher: Frontend auf den Stand VOR p_request_id zuruecksetzen bzw. die App nicht benutzen,
-- sonst schlaegt der RPC-Aufruf fehl. Verlust: gespeicherte request_id-Werte.
BEGIN;
DROP FUNCTION IF EXISTS public.save_account_reconciliation(numeric,timestamptz,text,text,jsonb,uuid);
DROP INDEX IF EXISTS public.kontostaende_request_id_key;
ALTER TABLE public.kontostaende DROP COLUMN IF EXISTS request_id;
COMMIT;
