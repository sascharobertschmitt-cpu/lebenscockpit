-- POSTFLIGHT fuer die Sicherheitsmigrationen (20261114200200 Rechte, 20261114200300 RESTRICT). Nur SELECT.
-- Erwartung nach der Migration: ok ist fuer JEDE Zeile true. Vorher sind die Zeilen 1-5 erwartungsgemaess false.
SELECT name, ok FROM (VALUES
  ('1 anon/authenticated ohne TRUNCATE, REFERENCES, TRIGGER auf allen public-Tabellen',
    NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN unnest(ARRAY['anon','authenticated']) r CROSS JOIN unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER']) p
      WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND has_table_privilege(r, c.oid, p))),
  ('2 anon ohne jegliche Tabellenrechte (SELECT/INSERT/UPDATE/DELETE)',
    NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
      WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND has_table_privilege('anon', c.oid, p))),
  ('3 kein Recht an PUBLIC auf public-Tabellen',
    NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND a.grantee = 0)),
  ('4 bankumsaetze: authenticated nur SELECT und INSERT',
    has_table_privilege('authenticated','public.bankumsaetze','SELECT') AND has_table_privilege('authenticated','public.bankumsaetze','INSERT')
    AND NOT has_table_privilege('authenticated','public.bankumsaetze','UPDATE') AND NOT has_table_privilege('authenticated','public.bankumsaetze','DELETE')),
  ('5 Default-Privileges: neue Tabellen von postgres ohne anon und ohne TRUNCATE/REFERENCES/TRIGGER fuer authenticated',
    NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
      WHERE d.defaclobjtype='r' AND d.defaclnamespace='public'::regnamespace AND d.defaclrole='postgres'::regrole
        AND ((a.grantee = 'anon'::regrole) OR (a.grantee = 'authenticated'::regrole AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER'))))),
  ('6 authenticated behaelt SELECT/INSERT/UPDATE/DELETE auf den App-Tabellen',
    NOT EXISTS (SELECT 1 FROM unnest(ARRAY['aufgaben','einnahmen','kontostaende','posten','posten_zahlungen']) t CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
      WHERE NOT has_table_privilege('authenticated', 'public.'||t, p))),
  ('7 service_role unberuehrt (SELECT/INSERT/UPDATE/DELETE auf allen Tabellen)',
    NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
      WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND NOT has_table_privilege('service_role', c.oid, p))),
  ('8 RLS auf allen public-Tabellen aktiv',
    NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)),
  ('9 FK posten_zahlungen -> posten ist RESTRICT',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname='posten_zahlungen_posten_id_fkey' AND conrelid='public.posten_zahlungen'::regclass AND confdeltype='r'))
) AS t(name, ok)
ORDER BY name;
