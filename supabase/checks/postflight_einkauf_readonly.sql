-- POSTFLIGHT Wocheneinkauf (20261115100000 Tabellen, 20261115100100 Storage). Nur SELECT.
-- Erwartung nach beiden Migrationen: ok ist fuer JEDE Zeile true. Nach Teil 1 allein sind nur die Zeilen "S" rot.
SELECT name, ok FROM (VALUES
  ('T1 Tabellen einkauf_limits und einkaeufe vorhanden, RLS aktiv, je eine Policy nur fuer authenticated',
    (SELECT count(*) = 2 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('einkauf_limits','einkaeufe') AND c.relrowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polroles = ARRAY['authenticated'::regrole::oid]) = 1)),
  ('T2 anon ohne Rechte, authenticated ohne TRUNCATE/REFERENCES/TRIGGER, kein Recht an PUBLIC',
    NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.einkauf_limits','public.einkaeufe']) t
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE has_table_privilege('anon', t, p))
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.einkauf_limits','public.einkaeufe']) t
      CROSS JOIN unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege('authenticated', t, p))
    AND NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('einkauf_limits','einkaeufe') AND a.grantee = 0)),
  ('T3 authenticated hat SELECT/INSERT/UPDATE/DELETE',
    NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.einkauf_limits','public.einkaeufe']) t
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE NOT has_table_privilege('authenticated', t, p))),
  ('T4 FK einkaeufe.limit_id ist RESTRICT',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.einkaeufe'::regclass AND contype='f' AND confdeltype='r')),
  ('S1 Bucket belege: privat, max 3 MB, nur image/jpeg',
    EXISTS (SELECT 1 FROM storage.buckets WHERE id='belege' AND NOT public AND file_size_limit = 3145728 AND allowed_mime_types = ARRAY['image/jpeg'])),
  ('S2 genau drei Policies fuer den Bucket (lesen, hochladen, loeschen), nur authenticated, kein UPDATE',
    (SELECT count(*) = 3 FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname IN ('belege lesen','belege hochladen','belege loeschen')
       AND polroles = ARRAY['authenticated'::regrole::oid] AND polcmd IN ('r','a','d')))
) AS t(name, ok)
ORDER BY name;
