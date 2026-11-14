-- PREFLIGHT, rein lesend (nur SELECT). Vor den Migrationen gegen das Zielprojekt ausfuehren.
-- Erwartung: Spalte ok ist fuer JEDE Zeile true. Eine einzige false-Zeile = Rollout stoppen.
-- Auch nach einer bereits angewendeten Migration lauffaehig (Spalten "fehlen oder haben den richtigen Typ").
SELECT name, ok FROM (VALUES
  ('Tabellen aufgaben/kontostaende/posten/posten_zahlungen/mitglieder vorhanden',
    (SELECT count(*) = 5 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
       AND relname IN ('aufgaben','kontostaende','posten','posten_zahlungen','mitglieder'))),
  ('aufgaben.vorgaenger_id fehlt oder ist uuid',
    NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='aufgaben' AND column_name='vorgaenger_id')
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='aufgaben' AND column_name='vorgaenger_id' AND data_type='uuid')),
  ('aufgaben.auto_faellig fehlt oder ist date',
    NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='aufgaben' AND column_name='auto_faellig')
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='aufgaben' AND column_name='auto_faellig' AND data_type='date')),
  ('kontostaende.request_id fehlt oder ist uuid',
    NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='kontostaende' AND column_name='request_id')
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='kontostaende' AND column_name='request_id' AND data_type='uuid')),
  ('Indexnamen nicht von fremden Objekten belegt',
    NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace
      AND relname IN ('aufgaben_one_successor','kontostaende_request_id_key') AND relkind <> 'i')),
  ('keine unerwarteten Funktionsueberladungen (set_task_completion / save_account_reconciliation)',
    NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND ((proname='set_task_completion' AND oid::regprocedure::text <> 'set_task_completion(uuid,boolean)')
        OR (proname='save_account_reconciliation' AND oid::regprocedure::text NOT IN (
             'save_account_reconciliation(numeric,timestamp with time zone,text,text,jsonb)',
             'save_account_reconciliation(numeric,timestamp with time zone,text,text,jsonb,uuid)'))))),
  ('RLS aktiv und mindestens eine Policy auf aufgaben, kontostaende, posten, posten_zahlungen',
    (SELECT count(*) = 4 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relrowsecurity
       AND c.relname IN ('aufgaben','kontostaende','posten','posten_zahlungen')
       AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))),
  ('Policies gelten nur fuer authenticated (keine anon-/PUBLIC-Policy)',
    NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid IN ('public.aufgaben'::regclass,'public.kontostaende'::regclass,'public.posten'::regclass,'public.posten_zahlungen'::regclass)
      AND (p.polroles = '{0}' OR EXISTS (SELECT 1 FROM unnest(p.polroles) r WHERE r::regrole::text IN ('anon','public'))))),
  ('private.ist_mitglied() vorhanden, SECURITY DEFINER, fuer authenticated ausfuehrbar',
    EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'private.ist_mitglied()'::regprocedure AND prosecdef)
    AND has_function_privilege('authenticated','private.ist_mitglied()','EXECUTE')),
  ('auth.uid() und auth.jwt() vorhanden',
    (SELECT count(*) = 2 FROM pg_proc WHERE pronamespace='auth'::regnamespace AND proname IN ('uid','jwt'))),
  ('Unique (posten_id, finanzmonat) auf posten_zahlungen (Voraussetzung fuer ON CONFLICT)',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.posten_zahlungen'::regclass AND contype='u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (posten_id, finanzmonat)')),
  ('aufgaben.wiederholung erlaubt genau taeglich/woechentlich/monatlich/jaehrlich',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aufgaben'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%taeglich%' AND pg_get_constraintdef(oid) LIKE '%woechentlich%'
      AND pg_get_constraintdef(oid) LIKE '%monatlich%' AND pg_get_constraintdef(oid) LIKE '%jaehrlich%')),
  ('kontostaende.konto erlaubt nur sascha/luna',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.kontostaende'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%sascha%' AND pg_get_constraintdef(oid) LIKE '%luna%')),
  ('mindestens ein Mitglied vorhanden (sonst waere nach RLS niemand berechtigt)',
    (SELECT count(*) >= 1 FROM public.mitglieder)),
  ('alle kontostaende.konto-Werte gueltig (Constraint-Gegenprobe)',
    (SELECT count(*) = 0 FROM public.kontostaende WHERE konto NOT IN ('sascha','luna')))
) AS t(name, ok)
ORDER BY ok, name;
