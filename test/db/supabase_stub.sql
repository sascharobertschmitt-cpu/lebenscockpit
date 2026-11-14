-- Minimaler Nachbau der Supabase-Umgebung fuer isolierte Tests (keine echte Supabase-Instanz).
-- Rollen, auth.jwt() und die Default-Privileges, mit denen Supabase neue public-Tabellen versieht.
-- Wird in Quell- UND Zieldatenbank eingespielt, weil ein public/private-Dump weder Rollen
-- noch das auth-Schema enthaelt (wie bei einer echten Wiederherstellung in ein neues Projekt).
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
