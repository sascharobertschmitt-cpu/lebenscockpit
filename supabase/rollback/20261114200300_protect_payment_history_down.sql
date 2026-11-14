-- ROLLBACK von 20261114200300: stellt ON DELETE CASCADE wieder her (Loeschen eines Postens loescht seine Zahlungen).
BEGIN;
ALTER TABLE public.posten_zahlungen DROP CONSTRAINT IF EXISTS posten_zahlungen_posten_id_fkey;
ALTER TABLE public.posten_zahlungen
  ADD CONSTRAINT posten_zahlungen_posten_id_fkey FOREIGN KEY (posten_id) REFERENCES public.posten(id) ON DELETE CASCADE;
COMMIT;
