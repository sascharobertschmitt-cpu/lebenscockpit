-- Security hardening: TRUNCATE is not protected by row-level security.
-- Run only after a verified backup, restore rehearsal and review.
-- Existing SELECT/INSERT/UPDATE/DELETE rights and RLS policies are unchanged.
BEGIN;
REVOKE TRUNCATE ON TABLE
  public.mitglieder,
  public.einnahmen,
  public.posten,
  public.posten_zahlungen,
  public.kontostaende,
  public.aufgaben
FROM anon, authenticated;
COMMIT;
