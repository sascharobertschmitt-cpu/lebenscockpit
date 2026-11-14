#!/usr/bin/env bash
# Isolierte PostgreSQL-Integrationstests fuer sql/*.sql (keine Supabase-Produktion, nur synthetische Daten).
# Nutzung: PGHOST/PGUSER/PGPASSWORD/PGPORT setzen (Superuser eines Wegwerf-Servers), dann ./test/db/run.sh
set -u
cd "$(dirname "$0")/../.."
DB=lc_test
export PGDATABASE=postgres
case "${PGHOST:-}" in ""|localhost|127.0.0.1|/*) ;; *) echo "Abbruch: nur lokaler Wegwerf-Server erlaubt (PGHOST=$PGHOST)"; exit 2;; esac
psql -qX -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" || exit 2
export PGDATABASE=$DB
for f in test/db/supabase_stub.sql test/db/schema_baseline.sql sql/task_completion_atomic.sql sql/account_reconciliation_atomic.sql; do
  psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "Setup fehlgeschlagen: $f"; exit 2; }
done
# Zweiter Durchlauf: Migrationen muessen idempotent sein.
for f in sql/task_completion_atomic.sql sql/account_reconciliation_atomic.sql; do
  psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "Nicht idempotent: $f"; exit 2; }
done
psql -qX -v ON_ERROR_STOP=1 -c "INSERT INTO public.mitglieder VALUES ('a@example.test','A'),('b@example.test','B')" >/dev/null

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
