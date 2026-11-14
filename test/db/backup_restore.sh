#!/usr/bin/env bash
# Isolierter Backup/Restore-Test mit ausschliesslich SYNTHETISCHEN Daten.
# Kein Zugriff auf Supabase-Produktion. Benoetigt einen wegwerfbaren PostgreSQL-17-Server.
#
# Ablauf:
#   1. Quelle: Supabase-Nachbau + produktionsnahes Schema + beide Migrationen
#   2. Funktionspruefung der Quelle (beweist, dass die Pruefungen ueberhaupt bestehen koennen)
#   3. pg_dump (custom, public+private, MIT Rechten), Pruefsumme, Inhaltsverzeichnis pruefen
#   4. Restore in neue Zieldatenbank, die wie ein frisches Supabase-Projekt vorbereitet ist
#   5. Sicherheitsmigrationen erneut anwenden (Teil des Restore-Verfahrens, siehe Doku)
#   6. Fingerabdruck Quelle == Ziel (Daten, Schema, RLS, Policies, Funktionen, Rechte)
#   7. Funktionspruefung des Ziels (RLS, anon, TRUNCATE, FK RESTRICT, Upsert)
#   8. Negativkontrollen: Test muss Datenabweichung, --no-acl und reinen public-Dump erkennen
#
# Aufruf aus dem Repo-Root mit Client-Werkzeugen derselben Hauptversion wie der Server, z. B.:
#   docker run --rm --network host -v "$PWD:/w" -w /w -e PGHOST=127.0.0.1 -e PGUSER=postgres \
#     -e PGPASSWORD=... postgres:17 bash test/db/backup_restore.sh
set -euo pipefail

PG_DUMP=${PG_DUMP:-pg_dump}
PG_RESTORE=${PG_RESTORE:-pg_restore}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
SRC=lc_restore_src
TGT=lc_restore_tgt
MIG_HIST=supabase/migrations/20261114110000_protect_payment_history.sql
MIG_PRIV=supabase/migrations/20261114120000_revoke_truncate_from_api_roles.sql

fail() { echo "FEHLER: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

fresh_db() { dropdb --if-exists "$1"; createdb "$1"; }
fingerprint() { "${PSQL[@]}" -d "$1" -f test/db/fingerprint.sql; }

# Ziel wie frisches Supabase-Projekt: Rollen, auth, public-Schema mit Default-Privileges.
# public existiert dort bereits, daher den CREATE-SCHEMA-public-Eintrag des Dumps ueberspringen.
restore_into() { # $1=db $2=dumpdatei $3..=zusaetzliche pg_restore-Optionen
  local db=$1 dump=$2; shift 2
  fresh_db "$db"
  "${PSQL[@]}" -d "$db" -f test/db/supabase_stub.sql
  $PG_RESTORE --list < "$dump" | grep -v -E ' SCHEMA - public | COMMENT - SCHEMA public ' > "$WORK/$db.list"
  $PG_RESTORE --exit-on-error --no-owner -d "$db" -L "$WORK/$db.list" "$@" < "$dump"
}

step "Werkzeugversionen"
server_major=$("${PSQL[@]}" -At -d postgres -c "SHOW server_version_num" | cut -c1-2)
dump_major=$($PG_DUMP --version | grep -oE '[0-9]+' | head -1)
restore_major=$($PG_RESTORE --version | grep -oE '[0-9]+' | head -1)
echo "Server $server_major, pg_dump $dump_major, pg_restore $restore_major"
[[ "$dump_major" == "$server_major" && "$restore_major" == "$server_major" ]] \
  || fail "Client- und Server-Hauptversion muessen gleich sein"

step "1. Quelle aufbauen"
fresh_db "$SRC"
"${PSQL[@]}" -d "$SRC" -f test/db/supabase_stub.sql
"${PSQL[@]}" -d "$SRC" -f test/db/restore_fixture.sql
"${PSQL[@]}" -d "$SRC" -f "$MIG_HIST"
"${PSQL[@]}" -d "$SRC" -f "$MIG_PRIV"

step "2. Funktionspruefung Quelle"
"${PSQL[@]}" -d "$SRC" -f test/db/restore_checks.sql
fingerprint "$SRC" > "$WORK/src.txt"
[[ $(grep -c '^daten|' "$WORK/src.txt") -eq 6 ]] || fail "Fingerabdruck erfasst nicht alle 6 Tabellen"
grep -q '^daten|public.posten_zahlungen|3|' "$WORK/src.txt" || fail "Testdaten unvollstaendig"

step "3. Backup erstellen und pruefen"
$PG_DUMP --format=custom --no-owner --schema=public --schema=private -d "$SRC" > "$WORK/full.dump"
test -s "$WORK/full.dump" || fail "Dump leer"
sha256sum "$WORK/full.dump" | cut -d' ' -f1 | sed 's/^/sha256 (synthetisch): /'
$PG_RESTORE --list < "$WORK/full.dump" > "$WORK/toc.txt"
for t in mitglieder einnahmen posten posten_zahlungen kontostaende aufgaben; do
  grep -qE "TABLE DATA public $t " "$WORK/toc.txt" || fail "Dump ohne Daten von $t"
done
[[ $(grep -cE ' POLICY public ' "$WORK/toc.txt") -eq 5 ]] || fail "Dump enthaelt nicht 5 Policies"
grep -qE 'FUNCTION private ist_mitglied' "$WORK/toc.txt" || fail "Dump ohne private.ist_mitglied()"
grep -qE ' ACL public ' "$WORK/toc.txt" || fail "Dump ohne Rechte (ACL)"
grep -qE ' DEFAULT ACL ' "$WORK/toc.txt" || fail "Dump ohne Default-Privileges"

step "4. Restore in isolierte Zieldatenbank"
restore_into "$TGT" "$WORK/full.dump"
fingerprint "$TGT" > "$WORK/tgt_raw.txt"
if diff -u "$WORK/src.txt" "$WORK/tgt_raw.txt" > "$WORK/raw.diff"; then
  echo "Hinweis: Rechte schon ohne erneute Migration identisch"
else
  echo "Abweichungen direkt nach Restore (erwartet: nur Rechte durch Default-Privileges des Ziels):"
  grep -E '^[-+][a-z]' "$WORK/raw.diff" | grep -vE '^[-+](recht|defaultrecht)\|' && fail "Abweichung ausserhalb der Rechte"
  grep -cE '^[-+](recht|defaultrecht)\|' "$WORK/raw.diff" | sed 's/^/geaenderte Rechte-Zeilen: /'
  grep -E '^\+recht\|public\.posten_zahlungen\|anon\|TRUNCATE' "$WORK/raw.diff" || true
fi

step "5. Sicherheitsmigrationen erneut anwenden (idempotent)"
"${PSQL[@]}" -d "$TGT" -f "$MIG_PRIV"

step "6. Fingerabdruck Quelle == Ziel"
fingerprint "$TGT" > "$WORK/tgt.txt"
diff -u "$WORK/src.txt" "$WORK/tgt.txt" || fail "Wiederherstellung weicht von der Quelle ab"
echo "identisch: $(wc -l < "$WORK/src.txt") Pruefpunkte"

step "7. Funktionspruefung Ziel"
"${PSQL[@]}" -d "$TGT" -f test/db/restore_checks.sql

step "8a. Negativkontrolle: veraenderter Betrag muss auffallen"
"${PSQL[@]}" -d "$TGT" -c 'BEGIN' \
  -c "UPDATE public.posten_zahlungen SET betrag = betrag + 0.01 WHERE id = '30000000-0000-0000-0000-000000000003'" \
  -f test/db/fingerprint.sql -c 'ROLLBACK' > "$WORK/tampered.txt"
if diff -q "$WORK/src.txt" "$WORK/tampered.txt" >/dev/null; then fail "Datenabweichung nicht erkannt"; fi
diff "$WORK/src.txt" "$WORK/tampered.txt" > "$WORK/tampered.diff" || true
[[ $(grep -c '^[<>] ' "$WORK/tampered.diff") -eq 2 ]] \
  && grep -q '^> daten|public.posten_zahlungen|3|' "$WORK/tampered.diff" \
  || fail "Datenabweichung an falscher Stelle erkannt"
echo "erkannt"

step "8b. Negativkontrolle: Restore mit --no-acl ohne Migration muss auffallen"
restore_into lc_restore_noacl "$WORK/full.dump" --no-acl
fingerprint lc_restore_noacl > "$WORK/noacl.txt"
if diff -q "$WORK/src.txt" "$WORK/noacl.txt" >/dev/null; then fail "--no-acl-Restore nicht erkannt"; fi
if "${PSQL[@]}" -d lc_restore_noacl -f test/db/restore_checks.sql >/dev/null 2>&1; then
  fail "Funktionspruefung erkennt fehlende Haertung nicht"
fi
grep -cE '^recht\|public\.[a-z_]+\|anon\|[A-Z]+=true' "$WORK/noacl.txt" | sed 's/^/anon-Rechte nach --no-acl-Restore: /'
dropdb lc_restore_noacl

step "8c. Negativkontrolle: reiner public-Dump (ohne private) muss scheitern"
$PG_DUMP --format=custom --no-owner --schema=public -d "$SRC" > "$WORK/public_only.dump"
public_only_ok=true
if restore_into lc_restore_pubonly "$WORK/public_only.dump" 2> "$WORK/pubonly.err"; then
  "${PSQL[@]}" -d lc_restore_pubonly -f "$MIG_PRIV"
  "${PSQL[@]}" -d lc_restore_pubonly -f test/db/restore_checks.sql >/dev/null 2>&1 || public_only_ok=false
else
  public_only_ok=false
  grep -m1 -E 'ERROR|FEHLER' "$WORK/pubonly.err" | sed 's/^/erwarteter Fehler: /' || true
fi
$public_only_ok && fail "public-only-Dump wurde faelschlich als brauchbar bewertet"
dropdb --if-exists lc_restore_pubonly
echo "erkannt"

dropdb "$SRC"; dropdb "$TGT"
echo; echo "Backup/Restore-Test bestanden."
