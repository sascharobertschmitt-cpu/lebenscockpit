-- Schutz historischer Zahlungsbestätigungen.
-- WICHTIG: Nur nach gesicherter Sicherung und auf einer isolierten Testdatenbank
-- prüfen. Nicht automatisch gegen das Produktivprojekt ausführen.
--
-- Bisher: ON DELETE CASCADE entfernt beim Löschen eines Postens auch seine Zahlungen.
-- Neu: ON DELETE RESTRICT verweigert das Löschen des Postens, sobald Zahlungen existieren.
-- Die bestehende Posten-ID und sämtliche Zahlungsdatensätze bleiben unverändert.

BEGIN;

ALTER TABLE public.posten_zahlungen
  DROP CONSTRAINT posten_zahlungen_posten_id_fkey;

ALTER TABLE public.posten_zahlungen
  ADD CONSTRAINT posten_zahlungen_posten_id_fkey
  FOREIGN KEY (posten_id)
  REFERENCES public.posten(id)
  ON DELETE RESTRICT;

COMMIT;
