-- POSTFLIGHT, rein lesend (nur SELECT). Nach beiden Migrationen ausfuehren.
-- Erwartung: ok ist fuer JEDE Zeile true.
SELECT name, ok FROM (VALUES
  ('aufgaben.vorgaenger_id uuid, nullbar',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='aufgaben' AND column_name='vorgaenger_id' AND data_type='uuid' AND is_nullable='YES')),
  ('aufgaben.auto_faellig date, nullbar',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='aufgaben' AND column_name='auto_faellig' AND data_type='date' AND is_nullable='YES')),
  ('kontostaende.request_id uuid, nullbar',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='kontostaende' AND column_name='request_id' AND data_type='uuid' AND is_nullable='YES')),
  ('FK vorgaenger_id -> aufgaben(id) ON DELETE SET NULL',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aufgaben'::regclass AND contype='f'
      AND confrelid='public.aufgaben'::regclass AND confdeltype='n' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (vorgaenger_id)%')),
  ('partieller Unique-Index aufgaben_one_successor',
    EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='aufgaben_one_successor'
      AND c.relnamespace='public'::regnamespace AND i.indisunique AND i.indpred IS NOT NULL AND i.indrelid='public.aufgaben'::regclass)),
  ('partieller Unique-Index kontostaende_request_id_key',
    EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='kontostaende_request_id_key'
      AND c.relnamespace='public'::regnamespace AND i.indisunique AND i.indpred IS NOT NULL AND i.indrelid='public.kontostaende'::regclass)),
  ('set_task_completion: SECURITY INVOKER, search_path leer',
    EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.set_task_completion(uuid,boolean)')
      AND NOT prosecdef AND proconfig @> ARRAY['search_path=""'])),
  ('save_account_reconciliation(6 Arg.): SECURITY INVOKER, search_path leer',
    EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.save_account_reconciliation(numeric,timestamptz,text,text,jsonb,uuid)')
      AND NOT prosecdef AND proconfig @> ARRAY['search_path=""'])),
  ('alte 5-Argument-Variante save_account_reconciliation entfernt',
    to_regprocedure('public.save_account_reconciliation(numeric,timestamptz,text,text,jsonb)') IS NULL),
  ('set_task_completion: authenticated ja, anon und PUBLIC nein',
    to_regprocedure('public.set_task_completion(uuid,boolean)') IS NOT NULL
    AND has_function_privilege('authenticated', to_regprocedure('public.set_task_completion(uuid,boolean)'), 'EXECUTE')
    AND NOT has_function_privilege('anon', to_regprocedure('public.set_task_completion(uuid,boolean)'), 'EXECUTE')
    AND NOT has_function_privilege('public', to_regprocedure('public.set_task_completion(uuid,boolean)'), 'EXECUTE')),
  ('save_account_reconciliation: authenticated ja, anon und PUBLIC nein',
    to_regprocedure('public.save_account_reconciliation(numeric,timestamptz,text,text,jsonb,uuid)') IS NOT NULL
    AND has_function_privilege('authenticated', to_regprocedure('public.save_account_reconciliation(numeric,timestamptz,text,text,jsonb,uuid)'), 'EXECUTE')
    AND NOT has_function_privilege('anon', to_regprocedure('public.save_account_reconciliation(numeric,timestamptz,text,text,jsonb,uuid)'), 'EXECUTE')
    AND NOT has_function_privilege('public', to_regprocedure('public.save_account_reconciliation(numeric,timestamptz,text,text,jsonb,uuid)'), 'EXECUTE')),
  ('RLS weiterhin aktiv auf aufgaben, kontostaende, posten, posten_zahlungen',
    (SELECT count(*) = 4 FROM pg_class WHERE relnamespace='public'::regnamespace AND relrowsecurity
       AND relname IN ('aufgaben','kontostaende','posten','posten_zahlungen'))),
  ('Bestandsdaten unberuehrt: kein Altsatz hat vorgaenger_id, auto_faellig oder request_id',
    (SELECT count(*) = 0 FROM public.aufgaben WHERE vorgaenger_id IS NOT NULL OR auto_faellig IS NOT NULL)
    AND (SELECT count(*) = 0 FROM public.kontostaende WHERE request_id IS NOT NULL))
) AS t(name, ok)
ORDER BY ok, name;
