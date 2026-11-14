-- DRAFT: Execute through an authorized Supabase Storage administration context.
-- Do not modify storage schema object ownership.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('belege','belege',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
-- Verify existing bucket settings if this statement did nothing.
