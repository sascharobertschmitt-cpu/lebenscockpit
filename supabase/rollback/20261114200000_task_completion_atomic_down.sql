-- ROLLBACK von Migration 1/2. NICHT automatisch ausfuehren (liegt bewusst ausserhalb von supabase/migrations).
-- Vorher: Frontend auf den Stand VOR set_task_completion zuruecksetzen.
-- Verlust: vorgaenger_id-Verknuepfungen und auto_faellig der seither erzeugten Folgeaufgaben.
-- Die Folgeaufgaben selbst bleiben als normale Aufgaben erhalten.
BEGIN;
DROP FUNCTION IF EXISTS public.set_task_completion(uuid,boolean);
DROP INDEX IF EXISTS public.aufgaben_one_successor;
ALTER TABLE public.aufgaben DROP COLUMN IF EXISTS auto_faellig;
ALTER TABLE public.aufgaben DROP COLUMN IF EXISTS vorgaenger_id;
COMMIT;
