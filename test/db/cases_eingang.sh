# Belege-Eingang: Tabelle, Rechte, RLS und die atomare Zuordnung beleg_zuordnen().
echo "# Belege-Eingang"
G1=supabase/migrations/20261115100200_beleg_eingang.sql
GD=supabase/rollback/20261115100200_beleg_eingang_down.sql
psql -qX -v ON_ERROR_STOP=1 -f $G1 >/dev/null 2>&1 || bad "Migration anwenden"
psql -qX -v ON_ERROR_STOP=1 -f $G1 >/dev/null 2>&1 && ok "idempotent: $(basename $G1)" || bad "nicht idempotent"
red=$(psql -qX -v ON_ERROR_STOP=1 -tA -F' | ' -f supabase/checks/postflight_eingang_readonly.sql | grep -cE '\| f$'); expect_val "Eingang-Postflight gruen" 0 "$red"

LA=dddddddd-0000-0000-0000-000000000001; LI=dddddddd-0000-0000-0000-000000000002
su "INSERT INTO public.einkauf_limits(id,name,wochenlimit,aktiv) VALUES ('$LA','Eingang-Aktiv',50,true),('$LI','Eingang-Beendet',50,false)" >/dev/null
B1=eeeeeeee-0000-4000-8000-000000000001; B2=eeeeeeee-0000-4000-8000-000000000002; B3=eeeeeeee-0000-4000-8000-000000000003
add() { asA "INSERT INTO public.beleg_eingang(id,beleg_pfad) VALUES ('$1','$1.jpg')"; }
add $B1 >/dev/null; add $B2 >/dev/null; add $B3 >/dev/null
expect_val "Mitglied legt Belege im Eingang ab (erfasst_von aus JWT)" "3|a@example.test" "$(su "SELECT count(*), max(erfasst_von) FROM public.beleg_eingang WHERE id IN ('$B1','$B2','$B3')")"

for pf in "'$B1.jpg'" "'x.jpg'" "'../$B1.jpg'" "'$B1.png'"; do
  out=$(asA "INSERT INTO public.beleg_eingang(id,beleg_pfad) VALUES ('eeeeeeee-0000-4000-8000-0000000000f1', $pf)"); expect_err "Eingang: Pfad $pf abgelehnt" "violates" "$out"
done
out=$(asX "INSERT INTO public.beleg_eingang(id,beleg_pfad) VALUES ('eeeeeeee-0000-4000-8000-0000000000f2','eeeeeeee-0000-4000-8000-0000000000f2.jpg')"); expect_err "Nicht-Mitglied: Eingang blockiert" "row-level security" "$out"
expect_val "Nicht-Mitglied sieht keinen Eingang" 0 "$(asX "SELECT count(*) FROM public.beleg_eingang" | head -1)"
out=$(asAnon "SELECT count(*) FROM public.beleg_eingang"); expect_err "anon: Eingang nicht lesbar" "permission denied" "$out"
out=$(asA "TRUNCATE public.beleg_eingang"); expect_err "authenticated: TRUNCATE verweigert" "permission denied" "$out"
out=$(asAnon "TRUNCATE public.beleg_eingang"); expect_err "anon: TRUNCATE verweigert" "permission denied" "$out"

# --- beleg_zuordnen ---
Z() { echo "SELECT public.beleg_zuordnen('$1','$2','${3:-2026-11-13}',${4:-12.5},${5:-'Rewe'})"; }
asA "$(Z $B1 $LA)" >/dev/null
expect_val "Zuordnen: Einkauf mit Foto angelegt, Eingangszeile weg" "1|$B1.jpg|12.50|Rewe|a@example.test|0" "$(su "SELECT count(*), max(beleg_pfad), max(betrag), max(notiz), max(erfasst_von), (SELECT count(*) FROM public.beleg_eingang WHERE id='$B1') FROM public.einkaeufe WHERE id='$B1'")"
asA "$(Z $B1 $LA)" >/dev/null
expect_val "Wiederholung nach Zuordnung ist ein No-op" 1 "$(su "SELECT count(*) FROM public.einkaeufe WHERE id='$B1'")"
asB "$(Z $B1 $LA 2026-11-13 99)" >/dev/null
expect_val "  ... und ueberschreibt nichts" 12.50 "$(su "SELECT betrag FROM public.einkaeufe WHERE id='$B1'")"

out=$(asA "$(Z $B2 $LI)"); expect_err "Beendetes Limit abgelehnt" "inactive" "$out"
out=$(asA "$(Z $B2 dddddddd-0000-0000-0000-0000000000ff)"); expect_err "Unbekanntes Limit abgelehnt" "inactive" "$out"
out=$(asA "$(Z $B2 $LA 2026-11-13 0)"); expect_err "Betrag 0 abgelehnt" "violates" "$out"
out=$(asA "$(Z $B2 $LA 2026-11-13 -5)"); expect_err "Negativer Betrag abgelehnt" "violates" "$out"
out=$(asA "SELECT public.beleg_zuordnen('$B2','$LA',NULL,5,NULL)"); expect_err "Fehlendes Datum abgelehnt" "Missing" "$out"
out=$(asA "$(Z eeeeeeee-0000-4000-8000-0000000000aa $LA)"); expect_err "Unbekannter Beleg abgelehnt" "not found" "$out"
expect_val "Nach Fehlversuchen: Beleg noch im Eingang, kein Einkauf" "1|0" "$(su "SELECT (SELECT count(*) FROM public.beleg_eingang WHERE id='$B2'), (SELECT count(*) FROM public.einkaeufe WHERE id='$B2')")"
out=$(asX "$(Z $B2 $LA)"); expect_err "Nicht-Mitglied: Zuordnen verweigert" "not found\|row-level" "$out"
out=$(asAnon "$(Z $B2 $LA)"); expect_err "anon: kein Execute-Recht" "permission denied" "$out"
out=$(asA "SELECT set_config('request.jwt.claims','',true); SELECT public.beleg_zuordnen('$B2','$LA','2026-11-13',1,NULL)" 2>&1); expect_err "ohne JWT abgelehnt" "Authentication\|not found" "$out"
expect_val "Notiz nur aus Leerzeichen wird NULL" "t" "$(asA "$(Z $B2 $LA 2026-11-13 3 "'   '")" >/dev/null; su "SELECT notiz IS NULL FROM public.einkaeufe WHERE id='$B2'")"

# Parallel: zwei gleichzeitige Zuordnungen desselben Belegs -> genau ein Einkauf
( asA "$(Z $B3 $LA 2026-11-13 7); SELECT pg_sleep(2)" >/dev/null ) &
sleep 0.7
asB "$(Z $B3 $LA 2026-11-13 8)" >/dev/null
wait
expect_val "Parallel zugeordnet: genau ein Einkauf, Eingang leer" "1|0" "$(su "SELECT (SELECT count(*) FROM public.einkaeufe WHERE id='$B3'), (SELECT count(*) FROM public.beleg_eingang WHERE id='$B3')")"

# Wochenlimit-Rechnung sieht die zugeordneten Einkaeufe (Foto bleibt verknuepft)
expect_val "Zugeordnete Einkaeufe tragen ihren Beleg" 3 "$(su "SELECT count(*) FROM public.einkaeufe WHERE beleg_pfad IS NOT NULL AND id IN ('$B1','$B2','$B3')")"

# --- Rollback ---
add eeeeeeee-0000-4000-8000-000000000004 >/dev/null
out=$(psql -qX -v ON_ERROR_STOP=1 -f $GD 2>&1); expect_err "Rollback verweigert sich bei offenen Belegen" "Abbruch" "$out"
su "DELETE FROM public.beleg_eingang" >/dev/null
psql -qX -v ON_ERROR_STOP=1 -f $GD >/dev/null 2>&1 && ok "Rollback ohne offene Belege" || bad "Rollback ohne offene Belege"
expect_val "  ... Tabelle und Funktion entfernt" 0 "$(su "SELECT (to_regclass('public.beleg_eingang') IS NOT NULL)::int + (to_regprocedure('public.beleg_zuordnen(uuid,uuid,date,numeric,text)') IS NOT NULL)::int")"
psql -qX -v ON_ERROR_STOP=1 -f $G1 >/dev/null 2>&1 || bad "Neuanwendung"
red=$(psql -qX -v ON_ERROR_STOP=1 -tA -F' | ' -f supabase/checks/postflight_eingang_readonly.sql | grep -cE '\| f$'); expect_val "Neuanwendung: Postflight gruen" 0 "$red"
su "DELETE FROM public.einkaeufe WHERE limit_id IN ('$LA','$LI'); DELETE FROM public.einkauf_limits WHERE id IN ('$LA','$LI')" >/dev/null
