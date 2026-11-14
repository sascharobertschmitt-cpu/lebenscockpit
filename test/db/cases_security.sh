# Sicherheits-Migrationen: Rechte (bankumsaetze, TRUNCATE usw.) und RESTRICT-Fix fuer posten_zahlungen.
# Wird von run.sh nach den Hilfsfunktionen und VOR den RPC-Faellen eingebunden, damit die RPC-Faelle
# anschliessend unter den gehaerteten Rechten laufen (Endzustand wie in Produktion nach dem Rollout).
echo "# Sicherheits-Migrationen"
S1=supabase/migrations/20261114200200_revoke_truncate_from_api_roles.sql
S2=supabase/migrations/20261114200300_protect_payment_history.sql
D1=supabase/rollback/20261114200200_revoke_truncate_from_api_roles_down.sql
D2=supabase/rollback/20261114200300_protect_payment_history_down.sql
TABLES="mitglieder einnahmen posten posten_zahlungen kontostaende aufgaben bankumsaetze"
priv() { su "SELECT has_table_privilege('$1','public.$2','$3')"; }

# Vor-Zustand wie in Produktion (pg_class.relacl, 14.11.2026): alte Tabellen ohne TRUNCATE/REFERENCES/TRIGGER,
# bankumsaetze mit allen Rechten fuer anon und authenticated. Backup-Rolle wie im Backup-Workflow.
su "REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.mitglieder, public.einnahmen, public.posten, public.posten_zahlungen, public.kontostaende, public.aufgaben FROM anon, authenticated" >/dev/null
su "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='backup_reader') THEN CREATE ROLE backup_reader NOLOGIN BYPASSRLS; GRANT pg_read_all_data TO backup_reader; END IF; END \$\$" >/dev/null
P1=aaaaaaaa-0000-0000-0000-000000000001; P2=aaaaaaaa-0000-0000-0000-000000000002
su "INSERT INTO public.posten(id,name,betrag) VALUES ('$P1','Fixture mit Zahlung',10),('$P2','Fixture ohne Zahlung',5)" >/dev/null
su "INSERT INTO public.posten_zahlungen(posten_id,finanzmonat,betrag) VALUES ('$P1','2026-10-25',10)" >/dev/null
su "INSERT INTO public.bankumsaetze(konto,buchungsdatum,betrag,import_key) VALUES ('sascha','2026-11-01',1.50,'k0')" >/dev/null

vorher=$(psql -qX -v ON_ERROR_STOP=1 -tA -F' | ' -f supabase/checks/postflight_security_readonly.sql | grep -cE '\| f$')
[ "$vorher" -ge 4 ] && ok "Security-Postflight ist vor der Migration rot ($vorher Pruefungen)" || bad "Security-Postflight vorher nicht rot" "($vorher)"
expect_val "vorher: authenticated darf bankumsaetze leeren (Fehlerzustand vorhanden)" t "$(priv authenticated bankumsaetze TRUNCATE)"
expect_val "vorher: anon darf bankumsaetze leeren (Fehlerzustand vorhanden)" t "$(priv anon bankumsaetze TRUNCATE)"
expect_val "vorher: Zahlungen loeschen per CASCADE (Fehlerzustand vorhanden)" c "$(su "SELECT confdeltype FROM pg_constraint WHERE conname='posten_zahlungen_posten_id_fkey'")"

for f in $S1 $S2; do psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || bad "Migration anwenden: $f"; done
for f in $S1 $S2; do psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 && ok "idempotent: $(basename $f)" || bad "nicht idempotent: $f"; done
su "CREATE TABLE public.neu_nach_migration (id int); ALTER TABLE public.neu_nach_migration ENABLE ROW LEVEL SECURITY" >/dev/null

# --- Rechte-Matrix (Katalog) ---
leak=""; keep_ok=1
for t in $TABLES neu_nach_migration; do
  for r in anon authenticated; do
    for p in TRUNCATE REFERENCES TRIGGER; do [ "$(priv $r $t $p)" = t ] && leak="$leak $r:$t:$p"; done
  done
  for p in SELECT INSERT UPDATE DELETE; do [ "$(priv anon $t $p)" = t ] && leak="$leak anon:$t:$p"; done
done
expect_val "nachher: kein TRUNCATE/REFERENCES/TRIGGER fuer anon/authenticated, anon ganz ohne Rechte (alle Tabellen)" "" "$leak"
for t in $TABLES; do for p in SELECT INSERT; do [ "$(priv authenticated $t $p)" = t ] || keep_ok=0; done; done
for t in mitglieder einnahmen posten posten_zahlungen kontostaende aufgaben; do for p in UPDATE DELETE; do [ "$(priv authenticated $t $p)" = t ] || keep_ok=0; done; done
expect_val "nachher: authenticated behaelt SELECT/INSERT (alle) und UPDATE/DELETE (App-Tabellen)" 1 "$keep_ok"
expect_val "nachher: bankumsaetze ohne UPDATE/DELETE fuer authenticated" "f|f" "$(priv authenticated bankumsaetze UPDATE)|$(priv authenticated bankumsaetze DELETE)"
expect_val "nachher: service_role unberuehrt (TRUNCATE auf bankumsaetze)" t "$(priv service_role bankumsaetze TRUNCATE)"
expect_val "nachher: backup_reader liest weiterhin (pg_read_all_data)" 1 "$(su "SET ROLE backup_reader; SELECT count(*) FROM public.bankumsaetze; RESET ROLE" | head -1)"

nachher=$(psql -qX -v ON_ERROR_STOP=1 -tA -F' | ' -f supabase/checks/postflight_security_readonly.sql | grep -cE '\| f$')
expect_val "Security-Postflight nach der Migration vollstaendig gruen" 0 "$nachher"

# --- Echte Ausfuehrung ---
for t in $TABLES; do
  out=$(asA "TRUNCATE public.$t CASCADE" 2>&1); expect_err "authenticated: TRUNCATE $t verweigert" "permission denied" "$out"
  out=$(asAnon "TRUNCATE public.$t CASCADE" 2>&1); expect_err "anon: TRUNCATE $t verweigert" "permission denied" "$out"
done
expect_val "Daten nach TRUNCATE-Versuchen unveraendert" "1|1|1|2|1" "$(su "SELECT (SELECT count(*) FROM public.bankumsaetze),(SELECT count(*) FROM public.posten_zahlungen),(SELECT count(*) FROM public.mitglieder)-1,(SELECT count(*) FROM public.posten),(SELECT count(*) FROM public.bankumsaetze WHERE import_key='k0')")"
out=$(asAnon "SELECT count(*) FROM public.bankumsaetze"); expect_err "anon: SELECT bankumsaetze verweigert" "permission denied" "$out"
out=$(asA "UPDATE public.bankumsaetze SET betrag = 0"); expect_err "Mitglied: UPDATE bankumsaetze verweigert" "permission denied" "$out"
out=$(asA "DELETE FROM public.bankumsaetze"); expect_err "Mitglied: DELETE bankumsaetze verweigert" "permission denied" "$out"
# CSV-Import wie in der App: upsert(..., onConflict 'konto,import_key', ignoreDuplicates) = INSERT .. ON CONFLICT DO NOTHING
IMP="INSERT INTO public.bankumsaetze(konto,buchungsdatum,betrag,verwendungszweck,gegenpartei,import_key) VALUES ('sascha','2026-11-02',-9.99,'x','y','k1'),('sascha','2026-11-02',-9.99,'x','y','k1'),('sascha','2026-11-01',1.50,'','','k0') ON CONFLICT (konto,import_key) DO NOTHING"
asA "$IMP" >/dev/null; asB "$IMP" >/dev/null
expect_val "Mitglied: CSV-Upsert legt neue Zeile an, Duplikate ignoriert (idempotent)" "2" "$(su "SELECT count(*) FROM public.bankumsaetze")"
expect_val "Mitglied: Lesen bankumsaetze unter RLS" 2 "$(asA "SELECT count(*) FROM public.bankumsaetze" | head -1)"
out=$(asX "$IMP"); expect_err "Nicht-Mitglied: INSERT bankumsaetze von RLS blockiert" "row-level security" "$out"
expect_val "Nicht-Mitglied: sieht keine Bankumsaetze" 0 "$(asX "SELECT count(*) FROM public.bankumsaetze" | head -1)"

# --- RESTRICT-Fix posten_zahlungen ---
expect_val "FK posten_zahlungen_posten_id_fkey ist RESTRICT" r "$(su "SELECT confdeltype FROM pg_constraint WHERE conname='posten_zahlungen_posten_id_fkey'")"
expect_val "Bestandszahlung durch Migration unveraendert" "1|10" "$(su "SELECT count(*), max(betrag) FROM public.posten_zahlungen WHERE posten_id='$P1'")"
out=$(asA "DELETE FROM public.posten WHERE id='$P1'"); expect_err "Posten mit Zahlung loeschen: FK-Verletzung" "violates foreign key" "$out"
expect_val "  ... Posten und Zahlung bleiben" "1|1" "$(su "SELECT (SELECT count(*) FROM public.posten WHERE id='$P1'),(SELECT count(*) FROM public.posten_zahlungen WHERE posten_id='$P1')")"
asA "DELETE FROM public.posten WHERE id='$P2'" >/dev/null
expect_val "Posten ohne Zahlung loeschbar" 0 "$(su "SELECT count(*) FROM public.posten WHERE id='$P2'")"
asA "DELETE FROM public.posten_zahlungen WHERE posten_id='$P1'" >/dev/null
expect_val "Zahlung direkt loeschbar (Abwaehlen im Abgleich)" 0 "$(su "SELECT count(*) FROM public.posten_zahlungen WHERE posten_id='$P1'")"

# --- Rollback-Skripte ---
for f in $D1 $D2; do psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || bad "Rollback: $f"; done
expect_val "Rollback: FK wieder CASCADE" c "$(su "SELECT confdeltype FROM pg_constraint WHERE conname='posten_zahlungen_posten_id_fkey'")"
expect_val "Rollback: UPDATE/DELETE auf bankumsaetze fuer authenticated zurueck" "t|t" "$(priv authenticated bankumsaetze UPDATE)|$(priv authenticated bankumsaetze DELETE)"
for f in $S1 $S2; do psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || bad "Neuanwendung: $f"; done
expect_val "Neuanwendung: Endzustand gehaertet" "f|f|r" "$(priv authenticated bankumsaetze UPDATE)|$(priv anon bankumsaetze TRUNCATE)|$(su "SELECT confdeltype FROM pg_constraint WHERE conname='posten_zahlungen_posten_id_fkey'")"
su "DROP TABLE public.neu_nach_migration" >/dev/null
echo "# RPCs unter gehaerteten Rechten"
