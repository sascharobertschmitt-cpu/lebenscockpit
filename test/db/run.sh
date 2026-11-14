#!/usr/bin/env bash
# Isolierte PostgreSQL-Integrationstests fuer supabase/migrations/*.sql (keine Supabase-Produktion, nur synthetische Daten).
# Nutzung: PGHOST/PGUSER/PGPASSWORD/PGPORT setzen (Superuser eines Wegwerf-Servers), dann ./test/db/run.sh
set -u
cd "$(dirname "$0")/../.."
DB=lc_test
export PGDATABASE=postgres
case "${PGHOST:-}" in ""|localhost|127.0.0.1|/*) ;; *) echo "Abbruch: nur lokaler Wegwerf-Server erlaubt (PGHOST=$PGHOST)"; exit 2;; esac
psql -qX -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" || exit 2
export PGDATABASE=$DB
M1=supabase/migrations/20261114200000_task_completion_atomic.sql
M2=supabase/migrations/20261114200100_account_reconciliation_idempotent.sql
for f in test/db/supabase_stub.sql test/db/schema_baseline.sql; do
  psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "Setup fehlgeschlagen: $f"; exit 2; }
done
# Mitglieder vor dem Preflight anlegen (der Preflight verlangt mindestens eins, wie in Produktion).
# Mitglieder vor dem Preflight anlegen (der Preflight verlangt mindestens eins, wie in Produktion).
psql -qX -v ON_ERROR_STOP=1 -c "INSERT INTO public.mitglieder VALUES ('a@example.test','A'),('b@example.test','B')" >/dev/null
# Preflight (lesend) muss auf dem Vor-Migrations-Schema vollstaendig gruen sein.
check_flight() { # Datei Name
  local bad; bad=$(psql -qX -v ON_ERROR_STOP=1 -tA -F' | ' -f "$1" | grep -E '\| f$' || true)
  [ -z "$bad" ] || { echo "$2 fehlgeschlagen:"; echo "$bad"; exit 2; }
}
check_flight supabase/checks/preflight_readonly.sql Preflight
# Postflight muss VOR den Migrationen rot sein (Fehler oder f-Zeile), sonst prueft er nichts.
pre=$(psql -qX -v ON_ERROR_STOP=1 -tA -F' | ' -f supabase/checks/postflight_readonly.sql 2>&1); pre_rc=$?
{ [ $pre_rc -ne 0 ] || echo "$pre" | grep -qE '\| f$'; } || { echo "Postflight ist vor der Migration nicht rot"; exit 2; }
for f in $M1 $M2; do
  psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "Setup fehlgeschlagen: $f"; exit 2; }
done
# Zweiter Durchlauf: Migrationen muessen idempotent sein; Preflight bleibt danach gruen.
for f in $M1 $M2; do
  psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "Nicht idempotent: $f"; exit 2; }
done
check_flight supabase/checks/preflight_readonly.sql "Preflight (nach Migration)"
check_flight supabase/checks/postflight_readonly.sql Postflight
# Rollback-Skripte: rueckstandsfrei entfernen, danach erneut anwendbar.
for f in supabase/rollback/20261114200100_account_reconciliation_idempotent_down.sql supabase/rollback/20261114200000_task_completion_atomic_down.sql; do
  psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "Rollback fehlgeschlagen: $f"; exit 2; }
done
left=$(psql -qX -tA -c "select (select count(*) from information_schema.columns where table_schema='public' and column_name in ('vorgaenger_id','auto_faellig','request_id')) + (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('set_task_completion','save_account_reconciliation')) + (select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('aufgaben_one_successor','kontostaende_request_id_key'))")
[ "$left" = 0 ] || { echo "Rollback nicht rueckstandsfrei ($left Objekte uebrig)"; exit 2; }
check_flight supabase/checks/preflight_readonly.sql "Preflight (nach Rollback)"
for f in $M1 $M2; do
  psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "Neuanwendung nach Rollback fehlgeschlagen: $f"; exit 2; }
done
check_flight supabase/checks/postflight_readonly.sql "Postflight (nach Neuanwendung)"

PASS=0; FAIL=0
UA=00000000-0000-0000-0000-00000000000a; UX=00000000-0000-0000-0000-0000000000ff
ok()  { PASS=$((PASS+1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL - $1 ${2:-}"; }
# su EMAIL SQL : fuehrt SQL als 'authenticated' mit JWT aus (eigene Transaktion). 'anon' = Rolle anon ohne JWT.
as() { # as EMAIL SUB SQL
  psql -qX -v ON_ERROR_STOP=1 -tA 2>&1 <<SQL
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$2","email":"$1"}', true) \gset
$3;
COMMIT;
SQL
}
asA() { as a@example.test $UA "$1"; }
asB() { as b@example.test 00000000-0000-0000-0000-00000000000b "$1"; }
asX() { as x@example.test $UX "$1"; }
asAnon() { psql -qX -v ON_ERROR_STOP=1 -tA 2>&1 <<SQL
BEGIN; SET LOCAL ROLE anon; $1; COMMIT;
SQL
}
su() { psql -qX -v ON_ERROR_STOP=1 -tA -c "$1"; }
expect_val() { # name expected actual
  [ "$2" = "$3" ] && ok "$1" || bad "$1" "erwartet '$2', erhalten '$3'"; }
expect_err() { # name pattern output(+status via $?)
  local out="$3"; echo "$out" | grep -qi "$2" && ok "$1" || bad "$1" "Fehler '$2' erwartet, erhalten: $out"; }
reset() { su "TRUNCATE public.aufgaben, public.posten_zahlungen, public.posten, public.kontostaende CASCADE" >/dev/null; }
. test/db/cases_tasks.sh
. test/db/cases_finance.sh
echo; echo "Bestanden: $PASS, Fehlgeschlagen: $FAIL"
[ "$FAIL" -eq 0 ]
