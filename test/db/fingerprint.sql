-- Deterministischer Fingerabdruck von Daten, Schema, RLS und Rechten (public + private).
-- Ausgabe: eine Zeile pro Pruefpunkt, sortiert. Quelle und Wiederherstellung muessen
-- zeilengleich sein (diff). Enthaelt nur Pruefsummen und Strukturdefinitionen, keine Datenwerte.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
WITH
tabs AS (
  SELECT c.oid, n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p')
),
daten AS (
  SELECT 'daten|' || t.nspname || '.' || t.relname || '|' ||
    (xpath('/row/n/text()', query_to_xml(format(
       'SELECT count(*) AS n FROM %I.%I', t.nspname, t.relname), false, true, '')))[1]::text || '|' ||
    coalesce((xpath('/row/h/text()', query_to_xml(format(
       'SELECT md5(string_agg(x::text, E''\n'' ORDER BY x::text)) AS h FROM %I.%I x',
       t.nspname, t.relname), false, true, '')))[1]::text, 'leer') AS z
  FROM tabs t
),
spalten AS (
  SELECT 'spalte|' || t.nspname || '.' || t.relname || '.' || a.attname || '|' ||
         format_type(a.atttypid, a.atttypmod) || '|notnull=' || a.attnotnull || '|default=' ||
         coalesce(pg_get_expr(d.adbin, d.adrelid), '-') AS z
  FROM tabs t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
),
cons AS (
  SELECT 'constraint|' || t.nspname || '.' || t.relname || '|' || co.conname || '|' ||
         pg_get_constraintdef(co.oid) AS z
  FROM tabs t JOIN pg_constraint co ON co.conrelid = t.oid
),
idx AS (
  SELECT 'index|' || schemaname || '.' || indexname || '|' || indexdef AS z
  FROM pg_indexes WHERE schemaname IN ('public','private')
),
rls AS (
  SELECT 'rls|' || nspname || '.' || relname || '|enabled=' || relrowsecurity ||
         '|forced=' || relforcerowsecurity AS z FROM tabs
),
pol AS (
  SELECT 'policy|' || schemaname || '.' || tablename || '|' || policyname || '|' || permissive ||
         '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '-') || '|' ||
         coalesce(with_check, '-') AS z
  FROM pg_policies WHERE schemaname IN ('public','private')
),
fn AS (
  SELECT 'funktion|' || n.nspname || '.' || p.proname || '|secdef=' || p.prosecdef || '|config=' ||
         coalesce(array_to_string(p.proconfig, ','), '-') || '|md5=' || md5(pg_get_functiondef(p.oid)) AS z
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public','private')
),
fnrechte AS (
  SELECT 'funktionsrecht|' || n.nspname || '.' || p.proname || '|' || r.rolname || '|execute=' ||
         has_function_privilege(r.oid, p.oid, 'EXECUTE') AS z
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN pg_roles r
  WHERE n.nspname IN ('public','private') AND r.rolname IN ('anon','authenticated','service_role')
),
rechte AS (
  SELECT 'recht|' || t.nspname || '.' || t.relname || '|' || r.rolname || '|' || pr ||
         '=' || has_table_privilege(r.oid, t.oid, pr) AS z
  FROM tabs t
  CROSS JOIN pg_roles r
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
     || CASE WHEN current_setting('server_version_num')::int >= 170000
             THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END) pr
  WHERE r.rolname IN ('anon','authenticated','service_role')
),
defacl AS (
  SELECT 'defaultrecht|' || pg_get_userbyid(d.defaclrole) || '|' || coalesce(n.nspname, '*') || '|' ||
         d.defaclobjtype::text || '|' ||
         coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(d.defaclacl) x), '-') AS z
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE coalesce(n.nspname, 'public') IN ('public','private')
)
SELECT z FROM (
  SELECT z FROM daten UNION ALL SELECT z FROM spalten UNION ALL SELECT z FROM cons
  UNION ALL SELECT z FROM idx UNION ALL SELECT z FROM rls UNION ALL SELECT z FROM pol
  UNION ALL SELECT z FROM fn UNION ALL SELECT z FROM fnrechte UNION ALL SELECT z FROM rechte
  UNION ALL SELECT z FROM defacl
) alles ORDER BY z;
