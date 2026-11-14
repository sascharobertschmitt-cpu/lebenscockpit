-- ROLLBACK von Teil 2: entfernt nur die Policies (danach hat niemand mehr Zugriff auf den Bucket).
-- Den Bucket und seine Dateien NICHT per SQL loeschen: Supabase verbietet das direkte Loeschen aus storage.*.
-- Bucket "belege" bei Bedarf im Dashboard (Storage) oder per Storage-API leeren und entfernen.
BEGIN;
DROP POLICY IF EXISTS "belege lesen" ON storage.objects;
DROP POLICY IF EXISTS "belege hochladen" ON storage.objects;
DROP POLICY IF EXISTS "belege loeschen" ON storage.objects;
COMMIT;
