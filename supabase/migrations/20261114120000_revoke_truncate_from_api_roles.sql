-- Security hardening: TRUNCATE (und weitere nicht RLS-geschuetzte Rechte) fuer API-Rollen entziehen.
-- Nur nach verifiziertem Backup, Restore-Probe und Review produktiv ausfuehren.
--
-- Hintergrund: TRUNCATE, REFERENCES, TRIGGER und (ab PostgreSQL 17) MAINTAIN unterliegen
-- nicht der Row Level Security. anon/authenticated bekommen sie in Supabase ueber
-- Default-Privileges automatisch auf jede neue public-Tabelle.
--
-- Unveraendert bleiben SELECT/INSERT/UPDATE/DELETE sowie alle RLS-Policies;
-- service_role und postgres werden nicht angefasst.
BEGIN;

-- 1) Alle bestehenden Tabellen in public (nicht nur eine feste Liste), auch Rechte an PUBLIC.
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- 2) Default-Privileges, damit kuenftige Tabellen (von postgres angelegt) die Rechte nicht erneut erhalten.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;

-- 3) MAINTAIN existiert erst ab PostgreSQL 17 (erlaubt u. a. LOCK TABLE, VACUUM, REINDEX).
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

COMMIT;
