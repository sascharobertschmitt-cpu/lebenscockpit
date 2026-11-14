-- Funktionspruefung einer wiederhergestellten Datenbank: App-Zugriff, RLS, Rechte, Datenschutz.
-- Alles in Transaktionen mit ROLLBACK, die Wiederherstellung bleibt unveraendert.
\set ON_ERROR_STOP on

-- 1) Mitglied (authenticated mit passender E-Mail) sieht alle Datensaetze und kann schreiben
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","email":"mitglied-a@example.test"}', true) \gset dummy_
DO $$ BEGIN
  IF (SELECT count(*) FROM public.posten) <> 4 OR (SELECT count(*) FROM public.posten_zahlungen) <> 3
     OR (SELECT count(*) FROM public.einnahmen) <> 2 OR (SELECT count(*) FROM public.kontostaende) <> 2
     OR (SELECT count(*) FROM public.aufgaben) <> 2 THEN
    RAISE EXCEPTION 'Restore: Mitglied sieht nicht alle Datensaetze (RLS/Funktion defekt?)';
  END IF;
  INSERT INTO public.kontostaende (betrag, erfasst_von, konto) VALUES (1, 'mitglied-a@example.test', 'sascha');
  -- App-Upsert nutzt onConflict posten_id,finanzmonat: Unique-Constraint muss existieren
  INSERT INTO public.posten_zahlungen (posten_id, finanzmonat, betrag)
    VALUES ('20000000-0000-0000-0000-000000000001', '2026-11-01', 1150)
    ON CONFLICT (posten_id, finanzmonat) DO UPDATE SET betrag = EXCLUDED.betrag;
  IF (SELECT count(*) FROM public.posten_zahlungen) <> 3 THEN
    RAISE EXCEPTION 'Restore: Upsert hat Duplikat erzeugt';
  END IF;
END $$;
ROLLBACK;

-- 2) Angemeldet, aber kein Mitglied: sieht nichts, kann nichts schreiben
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","email":"fremd@example.test"}', true) \gset dummy_
DO $$ BEGIN
  IF (SELECT count(*) FROM public.posten) <> 0 OR (SELECT count(*) FROM public.kontostaende) <> 0 THEN
    RAISE EXCEPTION 'Restore: Nicht-Mitglied sieht Finanzdaten';
  END IF;
  BEGIN
    INSERT INTO public.aufgaben (titel) VALUES ('fremd');
    RAISE EXCEPTION 'Restore: Nicht-Mitglied konnte schreiben';
  EXCEPTION WHEN insufficient_privilege THEN NULL; -- RLS WITH CHECK
  END;
  IF (SELECT count(*) FROM public.mitglieder) <> 0 THEN
    RAISE EXCEPTION 'Restore: mitglieder ohne Policy lesbar';
  END IF;
END $$;
ROLLBACK;

-- 3) anon: kein Tabellenzugriff, kein TRUNCATE
BEGIN;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.posten LIMIT 1; RAISE EXCEPTION 'Restore: anon kann lesen';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN TRUNCATE public.aufgaben; RAISE EXCEPTION 'Restore: anon kann TRUNCATE';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;

-- 4) authenticated (Mitglied): kein TRUNCATE trotz RLS-Policy
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","email":"mitglied-a@example.test"}', true) \gset dummy_
DO $$ BEGIN
  BEGIN TRUNCATE public.posten_zahlungen; RAISE EXCEPTION 'Restore: authenticated kann TRUNCATE';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;

-- 5) Zahlungshistorie: Posten mit Zahlungen nicht loeschbar, ohne Historie schon
BEGIN;
DO $$ BEGIN
  BEGIN
    DELETE FROM public.posten WHERE id = '20000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Restore: Posten mit Historie wurde geloescht';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  DELETE FROM public.posten WHERE id = '20000000-0000-0000-0000-000000000003';
  IF FOUND IS NOT TRUE THEN RAISE EXCEPTION 'Restore: Posten ohne Historie nicht loeschbar'; END IF;
END $$;
ROLLBACK;

-- 6) Checks greifen weiterhin
BEGIN;
DO $$ BEGIN
  BEGIN INSERT INTO public.kontostaende (betrag, konto) VALUES (1, 'unbekannt');
    RAISE EXCEPTION 'Restore: CHECK auf konto fehlt';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;

\echo 'restore_checks: alle Pruefungen bestanden'
