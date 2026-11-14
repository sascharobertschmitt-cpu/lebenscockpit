-- (Uebernommen von Branch chore/phase0-tests, dort als 20261114120000; neu versioniert, siehe docs/migration-rollout-plan.md.)
-- Security hardening: TRUNCATE (und weitere nicht RLS-geschuetzte Rechte) fuer API-Rollen entziehen.
-- Nur nach verifiziertem Backup, Restore-Probe und Review produktiv ausfuehren.
--
-- Hintergrund: TRUNCATE, REFERENCES, TRIGGER und (ab PostgreSQL 17) MAINTAIN unterliegen
-- nicht der Row Level Security. anon/authenticated bekommen sie in Supabase ueber
-- Default-Privileges automatisch auf jede neue public-Tabelle.
--
-- Zusaetzlich verliert anon ALLE Tabellenrechte: anon hat auf keiner Tabelle eine Policy,
-- die App greift nur nach der Anmeldung (Rolle authenticated) auf Tabellen zu.
--
-- Unveraendert bleiben fuer authenticated SELECT/INSERT/UPDATE/DELETE sowie alle
-- RLS-Policies; service_role und postgres werden nicht angefasst.
BEGIN;

-- 1) Alle bestehenden Tabellen in public (nicht nur eine feste Liste), auch Rechte an PUBLIC.
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- 2) Default-Privileges, damit kuenftige Tabellen (von postgres angelegt) die Rechte nicht erneut erhalten.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;

-- 3) anon: keine Tabellenrechte, weder heute noch auf neuen Tabellen.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- 4) MAINTAIN existiert erst ab PostgreSQL 17 (erlaubt u. a. LOCK TABLE, VACUUM, REINDEX).
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- 5) bankumsaetze ist laut ihrer Anlage-Migration (grant select, insert) ein reines Anfuege-Journal.
--    Tatsaechlich haben anon UND authenticated ueber Default-Privileges alle Rechte erhalten.
--    anon ist oben bereits bereinigt; authenticated behaelt nur, was die App braucht
--    (SELECT, INSERT inkl. upsert ... ignoreDuplicates). UPDATE/DELETE gibt es in der App nicht.
REVOKE UPDATE, DELETE ON public.bankumsaetze FROM authenticated;

COMMIT;
