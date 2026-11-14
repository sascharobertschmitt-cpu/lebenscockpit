-- ROLLBACK von Teil 3. Verweigert sich, solange Belege im Eingang liegen (kein stilles Loeschen von Zuordnungen).
-- Fotos im Bucket bleiben bestehen und werden hier nicht angefasst.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.beleg_eingang) THEN
    RAISE EXCEPTION 'Abbruch: Es liegen noch Belege im Eingang. Erst zuordnen oder bewusst verwerfen.';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.beleg_zuordnen(uuid, uuid, date, numeric, text);
DROP TABLE IF EXISTS public.beleg_eingang;
COMMIT;
