-- ROLLBACK von Teil 1. Verweigert sich, sobald echte Daten existieren (kein stilles Loeschen von Einkaeufen).
-- Vorher Frontend zuruecksetzen. Beleg-Fotos im Bucket bleiben bestehen (siehe Teil 2).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.einkaeufe) OR EXISTS (SELECT 1 FROM public.einkauf_limits) THEN
    RAISE EXCEPTION 'Abbruch: Es gibt Limits oder Einkaeufe. Erst Backup/Export, dann bewusst manuell loeschen.';
  END IF;
END $$;
DROP TABLE IF EXISTS public.einkaeufe;
DROP TABLE IF EXISTS public.einkauf_limits;
COMMIT;
