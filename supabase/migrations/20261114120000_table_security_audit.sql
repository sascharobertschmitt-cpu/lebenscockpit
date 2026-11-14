-- Security audit: read-only, available only to approved signed-in members.
CREATE OR REPLACE FUNCTION public.table_security_audit()
RETURNS TABLE(table_name text, issue text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT c.relname::text,
    CASE
      WHEN c.relname <> ALL(ARRAY['mitglieder','einnahmen','posten','posten_zahlungen','kontostaende','aufgaben']) THEN 'Neue, noch nicht geprüfte Tabelle'
      WHEN NOT c.relrowsecurity THEN 'Row Level Security ist deaktiviert'
      WHEN has_table_privilege('anon',c.oid,'TRUNCATE') OR has_table_privilege('authenticated',c.oid,'TRUNCATE') THEN 'TRUNCATE-Berechtigung vorhanden'
      WHEN has_table_privilege('anon',c.oid,'TRIGGER') OR has_table_privilege('authenticated',c.oid,'TRIGGER') THEN 'TRIGGER-Berechtigung vorhanden'
      WHEN has_table_privilege('anon',c.oid,'REFERENCES') OR has_table_privilege('authenticated',c.oid,'REFERENCES') THEN 'REFERENCES-Berechtigung vorhanden'
      WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) THEN 'Keine RLS-Policy vorhanden'
      ELSE NULL
    END::text
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND (SELECT private.ist_mitglied())
    AND (
      c.relname <> ALL(ARRAY['mitglieder','einnahmen','posten','posten_zahlungen','kontostaende','aufgaben'])
      OR NOT c.relrowsecurity
      OR has_table_privilege('anon',c.oid,'TRUNCATE') OR has_table_privilege('authenticated',c.oid,'TRUNCATE')
      OR has_table_privilege('anon',c.oid,'TRIGGER') OR has_table_privilege('authenticated',c.oid,'TRIGGER')
      OR has_table_privilege('anon',c.oid,'REFERENCES') OR has_table_privilege('authenticated',c.oid,'REFERENCES')
      OR (c.relname <> 'mitglieder' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname))
    );
$$;
REVOKE ALL ON FUNCTION public.table_security_audit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.table_security_audit() TO authenticated;
