-- Regressionstest fuer 20261114120000_revoke_truncate_from_api_roles.sql
-- Bildet die Supabase-Voreinstellungen nach: Default-Privileges von postgres auf
-- public-Tabellen geben anon/authenticated/service_role alle Rechte.
-- Aufruf aus dem Repo-Root, in einer leeren Testdatenbank:
--   psql -v ON_ERROR_STOP=1 -f test/db/truncate_privileges.sql
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE TABLE public.mitglieder (id integer PRIMARY KEY, email text);
CREATE TABLE public.einnahmen (id integer PRIMARY KEY, betrag numeric);
CREATE TABLE public.posten (id integer PRIMARY KEY);
CREATE TABLE public.posten_zahlungen (id integer PRIMARY KEY, posten_id integer REFERENCES public.posten(id));
CREATE TABLE public.kontostaende (id integer PRIMARY KEY);
CREATE TABLE public.aufgaben (id integer PRIMARY KEY);
-- Worst case: zusaetzlich ein Recht an PUBLIC (REVOKE nur von anon/authenticated waere wirkungslos)
GRANT TRUNCATE ON public.aufgaben TO PUBLIC;

ALTER TABLE public.mitglieder ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.einnahmen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nur mitglieder" ON public.einnahmen
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
INSERT INTO public.mitglieder VALUES (1, 'a@example.test');
INSERT INTO public.einnahmen VALUES (1, 10);

-- Vorbedingung: der Fehlerzustand ist wirklich vorhanden
DO $$ BEGIN
  IF NOT has_table_privilege('anon','public.einnahmen','TRUNCATE')
     OR NOT has_table_privilege('authenticated','public.einnahmen','TRUNCATE') THEN
    RAISE EXCEPTION 'Testaufbau fehlerhaft: TRUNCATE sollte vor der Migration vorhanden sein';
  END IF;
END $$;

\i supabase/migrations/20261114120000_revoke_truncate_from_api_roles.sql
-- Idempotenz: zweiter Lauf darf nicht scheitern
\i supabase/migrations/20261114120000_revoke_truncate_from_api_roles.sql

-- Neue Tabelle NACH der Migration (testet die Default-Privileges)
CREATE TABLE public.neu_nach_migration (id integer);

-- 1) Katalogpruefung: keine destruktiven Rechte fuer PUBLIC, anon, authenticated
DO $$
DECLARE r text; t record; p text; privs text[];
BEGIN
  privs := ARRAY['TRUNCATE','REFERENCES','TRIGGER'];
  IF current_setting('server_version_num')::int >= 170000 THEN privs := privs || ARRAY['MAINTAIN']; END IF;
  FOR t IN SELECT c.oid, c.relname FROM pg_class c
           WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH p IN ARRAY privs LOOP
        IF has_table_privilege(r, t.oid, p) THEN
          RAISE EXCEPTION '% noch fuer % auf public.%', p, r, t.relname;
        END IF;
      END LOOP;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
               WHERE c.oid = t.oid AND a.grantee = 0
                 AND a.privilege_type = ANY(privs)) THEN
      RAISE EXCEPTION 'Recht fuer PUBLIC auf public.% vorhanden', t.relname;
    END IF;
  END LOOP;
END $$;

-- 2) Normale App-Rechte bleiben erhalten (RLS regelt die Zeilen)
DO $$
DECLARE r text; t record; p text;
BEGIN
  FOR t IN SELECT c.oid, c.relname FROM pg_class c
           WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
        IF NOT has_table_privilege(r, t.oid, p) THEN
          RAISE EXCEPTION '% faelschlich entfernt fuer % auf public.%', p, r, t.relname;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- 3) Echte Ausfuehrung je Rolle: TRUNCATE muss mit insufficient_privilege scheitern
DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    FOREACH t IN ARRAY ARRAY['mitglieder','einnahmen','posten','posten_zahlungen','kontostaende','aufgaben','neu_nach_migration'] LOOP
      BEGIN
        EXECUTE format('TRUNCATE TABLE public.%I CASCADE', t);
        RAISE EXCEPTION 'TRUNCATE gelang als % auf %', r, t USING ERRCODE = 'XX000';
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;
    RESET ROLE;
  END LOOP;
END $$;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.einnahmen) <> 1 OR (SELECT count(*) FROM public.mitglieder) <> 1 THEN
    RAISE EXCEPTION 'Daten nach TRUNCATE-Versuchen veraendert';
  END IF;
END $$;

-- 4) RLS unveraendert: authenticated (Policy) darf lesen/schreiben, anon und
--    mitglieder (ohne Policy) sehen nichts
BEGIN;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.einnahmen) <> 1 THEN RAISE EXCEPTION 'authenticated sieht einnahmen nicht'; END IF;
  INSERT INTO public.einnahmen VALUES (2, 20);
  UPDATE public.einnahmen SET betrag = 21 WHERE id = 2;
  DELETE FROM public.einnahmen WHERE id = 2;
  IF (SELECT count(*) FROM public.mitglieder) <> 0 THEN RAISE EXCEPTION 'mitglieder ohne Policy darf keine Zeilen liefern'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.einnahmen) <> 0 THEN RAISE EXCEPTION 'anon sieht einnahmen'; END IF;
END $$;
ROLLBACK;

SELECT 'TRUNCATE-Regressionstest bestanden' AS ergebnis;
