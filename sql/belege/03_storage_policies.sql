-- DRAFT: Must run as storage.objects owner or another genuinely authorized role.
-- DO NOT run as postgres without verified CREATE POLICY privileges.
-- Storage file path: <auth-user-uuid>/<receipt-uuid>/<filename>
create policy "belege_upload_mitglieder" on storage.objects
 for insert to authenticated
 with check (
  bucket_id = 'belege'
  and (select private.ist_mitglied())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
  and array_length(storage.foldername(name),1) = 2
 );
create policy "belege_download_mitglieder" on storage.objects
 for select to authenticated
 using (
  bucket_id = 'belege'
  and (select private.ist_mitglied())
  and exists (
    select 1 from public.belege b where b.storage_pfad = storage.objects.name
  )
 );
-- No UPDATE or DELETE: uploads are immutable, no upsert.
-- A failed metadata INSERT may leave an orphan file; client should report this,
-- and cleanup must be handled by a privileged, audited maintenance workflow.
