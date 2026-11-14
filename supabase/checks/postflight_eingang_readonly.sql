-- POSTFLIGHT Belege-Eingang (20261115100200). Nur SELECT. Erwartung: ok ist fuer JEDE Zeile true.
SELECT name, ok FROM (VALUES
  ('E1 Tabelle beleg_eingang: RLS aktiv, genau eine Policy nur fuer authenticated',
    EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.beleg_eingang') AND c.relrowsecurity
      AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polroles = ARRAY['authenticated'::regrole::oid]) = 1)),
  ('E2 anon ohne Rechte, authenticated ohne TRUNCATE/REFERENCES/TRIGGER, nichts fuer PUBLIC',
    to_regclass('public.beleg_eingang') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE has_table_privilege('anon','public.beleg_eingang',p))
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege('authenticated','public.beleg_eingang',p))
    AND NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = to_regclass('public.beleg_eingang') AND a.grantee = 0)),
  ('E3 authenticated: SELECT/INSERT/UPDATE/DELETE',
    to_regclass('public.beleg_eingang') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE NOT has_table_privilege('authenticated','public.beleg_eingang',p))),
  ('E4 beleg_zuordnen: SECURITY INVOKER, search_path leer',
    EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.beleg_zuordnen(uuid,uuid,date,numeric,text)')
      AND NOT prosecdef AND proconfig @> ARRAY['search_path=""'])),
  ('E5 beleg_zuordnen: authenticated ja, anon und PUBLIC nein',
    to_regprocedure('public.beleg_zuordnen(uuid,uuid,date,numeric,text)') IS NOT NULL
    AND has_function_privilege('authenticated', to_regprocedure('public.beleg_zuordnen(uuid,uuid,date,numeric,text)'), 'EXECUTE')
    AND NOT has_function_privilege('anon', to_regprocedure('public.beleg_zuordnen(uuid,uuid,date,numeric,text)'), 'EXECUTE')
    AND NOT has_function_privilege('public', to_regprocedure('public.beleg_zuordnen(uuid,uuid,date,numeric,text)'), 'EXECUTE'))
) AS t(name, ok)
ORDER BY name;
