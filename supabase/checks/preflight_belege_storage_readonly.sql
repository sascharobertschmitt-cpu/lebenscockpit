-- Nur lesende Vorabpruefung vor der Storage-Migration.
-- Kein Bucket wird angelegt, keine Policy geaendert.
SELECT 'storage.objects owner' AS check_name, pg_get_userbyid(c.relowner)::text AS result
FROM pg_class c WHERE c.oid='storage.objects'::regclass
UNION ALL
SELECT 'current_user', current_user
UNION ALL
SELECT 'can_create_policy_as_owner', CASE WHEN pg_has_role(current_user, c.relowner, 'MEMBER') THEN 'yes' ELSE 'no' END
FROM pg_class c WHERE c.oid='storage.objects'::regclass
UNION ALL
SELECT 'existing_belege_bucket', CASE WHEN EXISTS(SELECT 1 FROM storage.buckets WHERE id='belege') THEN 'yes' ELSE 'no' END
UNION ALL
SELECT 'existing_storage_policies', count(*)::text FROM pg_policies WHERE schemaname='storage' AND tablename='objects';
-- Achtung: Eine SQL-Editor-Sitzung kann einen anderen Ausfuehrungs-Role als supabase db push haben.
-- Der Role-Check ist ein Hinweis, kein Beweis, dass CREATE POLICY im Deploy gelingt.
