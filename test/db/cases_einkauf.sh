# Wocheneinkauf: Tabellen, Rechte, RLS und privater Beleg-Bucket.
echo "# Wocheneinkauf"
E1=supabase/migrations/20261115100000_einkauf_limits_und_einkaeufe.sql
E2=supabase/migrations/20261115100100_belege_storage.sql
ED1=supabase/rollback/20261115100000_einkauf_limits_und_einkaeufe_down.sql
ED2=supabase/rollback/20261115100100_belege_storage_down.sql
for f in $E1 $E2; do psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || bad "Migration anwenden: $f"; done
for f in $E1 $E2; do psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 && ok "idempotent: $(basename $f)" || bad "nicht idempotent: $f"; done
red=$(psql -qX -v ON_ERROR_STOP=1 -tA -F' | ' -f supabase/checks/postflight_einkauf_readonly.sql | grep -cE '\| f$'); expect_val "Einkauf-Postflight gruen" 0 "$red"

L1=bbbbbbbb-0000-0000-0000-000000000001
asA "INSERT INTO public.einkauf_limits(id,name,wochenlimit) VALUES ('$L1','Lebensmittel',80)" >/dev/null
expect_val "Mitglied legt Limit an" "Lebensmittel|80.00|t" "$(su "SELECT name,wochenlimit,aktiv FROM public.einkauf_limits WHERE id='$L1'")"
for bad_limit in "'Null',0" "'Minus',-5" "'Riesig',100001" "'  ',10" "'lebensmittel',50"; do
  out=$(asA "INSERT INTO public.einkauf_limits(name,wochenlimit) VALUES ($bad_limit)")
  expect_err "Limit abgelehnt: $bad_limit" "violates\|duplicate key" "$out"
done
UID1=cccccccc-0000-4000-8000-000000000001
asA "INSERT INTO public.einkaeufe(limit_id,datum,betrag,notiz,beleg_pfad) VALUES ('$L1','2026-11-13',23.45,'Rewe','$UID1.jpg')" >/dev/null
expect_val "Mitglied erfasst Einkauf; erfasst_von kommt aus dem JWT" "23.45|a@example.test" "$(su "SELECT betrag,erfasst_von FROM public.einkaeufe WHERE limit_id='$L1'")"
for bad_k in "0,NULL,NULL" "-3,NULL,NULL" "100000.01,NULL,NULL" "5,'$(printf 'x%.0s' $(seq 1 201))',NULL" "5,NULL,'../x.jpg'" "5,NULL,'x.png'" "5,NULL,'CCCCCCCC-0000-4000-8000-000000000009.jpg'" "5,NULL,'$UID1.jpg'"; do
  out=$(asA "INSERT INTO public.einkaeufe(limit_id,datum,betrag,notiz,beleg_pfad) VALUES ('$L1','2026-11-13',${bad_k%%,*},$(echo "${bad_k#*,}" | sed 's/,\([^,]*\)$/,\1/'))" 2>&1)
  expect_err "Einkauf abgelehnt: ${bad_k:0:28}" "violates\|duplicate key\|syntax" "$out"
done
expect_val "nach Fehlversuchen genau ein Einkauf" 1 "$(su "SELECT count(*) FROM public.einkaeufe")"
out=$(asA "DELETE FROM public.einkauf_limits WHERE id='$L1'"); expect_err "Limit mit Einkaeufen nicht loeschbar (RESTRICT)" "violates foreign key" "$out"
asA "UPDATE public.einkauf_limits SET aktiv=false, wochenlimit=90 WHERE id='$L1'" >/dev/null
expect_val "Limit deaktivieren und Betrag aendern moeglich" "f|90.00" "$(su "SELECT aktiv,wochenlimit FROM public.einkauf_limits WHERE id='$L1'")"
asB "UPDATE public.einkauf_limits SET aktiv=true WHERE id='$L1'" >/dev/null

out=$(asX "SELECT count(*) FROM public.einkaeufe"); expect_val "Nicht-Mitglied sieht keine Einkaeufe" 0 "$(echo "$out" | head -1)"
out=$(asX "INSERT INTO public.einkaeufe(limit_id,datum,betrag) VALUES ('$L1','2026-11-13',1)"); expect_err "Nicht-Mitglied: INSERT von RLS blockiert" "row-level security" "$out"
out=$(asX "INSERT INTO public.einkauf_limits(name,wochenlimit) VALUES ('X',1)"); expect_err "Nicht-Mitglied: Limit anlegen blockiert" "row-level security" "$out"
for t in einkauf_limits einkaeufe; do
  out=$(asAnon "SELECT count(*) FROM public.$t"); expect_err "anon: $t nicht lesbar" "permission denied" "$out"
  out=$(asA "TRUNCATE public.$t CASCADE"); expect_err "authenticated: TRUNCATE $t verweigert" "permission denied" "$out"
  out=$(asAnon "TRUNCATE public.$t CASCADE"); expect_err "anon: TRUNCATE $t verweigert" "permission denied" "$out"
done

# --- Storage ---
expect_val "Bucket belege: privat, 3 MB, nur JPEG" "f|3145728|{image/jpeg}" "$(su "SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='belege'")"
OBJ="$UID1.jpg"
asA "INSERT INTO storage.objects(bucket_id,name) VALUES ('belege','$OBJ')" >/dev/null
expect_val "Mitglied darf Beleg hochladen" 1 "$(su "SELECT count(*) FROM storage.objects WHERE name='$OBJ'")"
for n in "bad.png" "ordner/$UID1.jpg" "../$UID1.jpg" "CCCCCCCC-0000-4000-8000-000000000002.jpg"; do
  out=$(asA "INSERT INTO storage.objects(bucket_id,name) VALUES ('belege','$n')"); expect_err "Upload mit ungueltigem Namen blockiert: $n" "row-level security" "$out"
done
out=$(asA "INSERT INTO storage.objects(bucket_id,name) VALUES ('anderer','cccccccc-0000-4000-8000-000000000003.jpg')" 2>&1); expect_err "Upload in fremden Bucket blockiert" "row-level security\|foreign key" "$out"
out=$(asX "INSERT INTO storage.objects(bucket_id,name) VALUES ('belege','cccccccc-0000-4000-8000-000000000004.jpg')"); expect_err "Nicht-Mitglied: Upload blockiert" "row-level security" "$out"
out=$(asAnon "INSERT INTO storage.objects(bucket_id,name) VALUES ('belege','cccccccc-0000-4000-8000-000000000005.jpg')"); expect_err "anon: Upload blockiert" "row-level security\|permission denied" "$out"
expect_val "Mitglied sieht den Beleg" 1 "$(asB "SELECT count(*) FROM storage.objects WHERE bucket_id='belege'" | head -1)"
expect_val "Nicht-Mitglied sieht keinen Beleg" 0 "$(asX "SELECT count(*) FROM storage.objects WHERE bucket_id='belege'" | head -1)"
expect_val "anon sieht keinen Beleg" 0 "$(asAnon "SELECT count(*) FROM storage.objects WHERE bucket_id='belege'" | head -1)"
asA "UPDATE storage.objects SET name='cccccccc-0000-4000-8000-0000000000aa.jpg' WHERE name='$OBJ'" >/dev/null
expect_val "Belege sind unveraenderlich (kein UPDATE)" 1 "$(su "SELECT count(*) FROM storage.objects WHERE name='$OBJ'")"
asX "DELETE FROM storage.objects WHERE name='$OBJ'" >/dev/null
expect_val "Nicht-Mitglied kann nicht loeschen" 1 "$(su "SELECT count(*) FROM storage.objects WHERE name='$OBJ'")"
asA "DELETE FROM storage.objects WHERE name='$OBJ'" >/dev/null
expect_val "Mitglied kann Beleg loeschen" 0 "$(su "SELECT count(*) FROM storage.objects WHERE name='$OBJ'")"

# --- Rollback ---
out=$(psql -qX -v ON_ERROR_STOP=1 -f $ED1 2>&1); expect_err "Rollback Teil 1 verweigert sich bei vorhandenen Daten" "Abbruch" "$out"
expect_val "  ... Daten unveraendert" "1|1" "$(su "SELECT (SELECT count(*) FROM public.einkaeufe),(SELECT count(*) FROM public.einkauf_limits)")"
psql -qX -v ON_ERROR_STOP=1 -f $ED2 >/dev/null 2>&1 || bad "Rollback Teil 2"
asA "INSERT INTO storage.objects(bucket_id,name) VALUES ('belege','cccccccc-0000-4000-8000-000000000006.jpg')" >/dev/null 2>&1
expect_val "nach Rollback Teil 2: kein Upload mehr moeglich" 0 "$(su "SELECT count(*) FROM storage.objects WHERE name='cccccccc-0000-4000-8000-000000000006.jpg'")"
su "DELETE FROM public.einkaeufe; DELETE FROM public.einkauf_limits" >/dev/null
psql -qX -v ON_ERROR_STOP=1 -f $ED1 >/dev/null 2>&1 && ok "Rollback Teil 1 ohne Daten" || bad "Rollback Teil 1 ohne Daten"
expect_val "  ... Tabellen entfernt" 0 "$(su "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('einkauf_limits','einkaeufe')")"
for f in $E1 $E2; do psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || bad "Neuanwendung: $f"; done
red=$(psql -qX -v ON_ERROR_STOP=1 -tA -F' | ' -f supabase/checks/postflight_einkauf_readonly.sql | grep -cE '\| f$'); expect_val "Neuanwendung: Postflight gruen" 0 "$red"
su "TRUNCATE storage.objects" >/dev/null
