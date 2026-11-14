-- Wocheneinkauf, Teil 2/2: privater Storage-Bucket fuer Beleg-Fotos.
-- Getrennt von Teil 1, weil Policies auf storage.objects Rechte des Storage-Besitzers brauchen und in Produktion
-- vorab auf einem Testprojekt/Branch verifiziert werden muessen. Teil 1 und die App funktionieren auch ohne diesen Teil
-- (Einkaeufe ohne Foto); nur das Hochladen von Fotos scheitert dann mit einer klaren Meldung.
--
-- * privat (kein oeffentlicher Link), Anzeige nur ueber kurzlebige signierte URLs
-- * nur JPEG (die App kodiert Fotos vor dem Hochladen selbst neu), maximal 3 MB je Datei
-- * Zugriff nur fuer Mitglieder; Dateiname muss <uuid>.jpg sein; kein UPDATE (Belege sind unveraenderlich)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('belege', 'belege', false, 3145728, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "belege lesen" ON storage.objects;
CREATE POLICY "belege lesen" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'belege' AND (SELECT private.ist_mitglied()));
DROP POLICY IF EXISTS "belege hochladen" ON storage.objects;
CREATE POLICY "belege hochladen" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'belege' AND (SELECT private.ist_mitglied())
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$');
DROP POLICY IF EXISTS "belege loeschen" ON storage.objects;
CREATE POLICY "belege loeschen" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'belege' AND (SELECT private.ist_mitglied()));
