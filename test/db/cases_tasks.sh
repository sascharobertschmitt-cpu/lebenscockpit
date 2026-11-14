# Aufgaben-RPC set_task_completion
echo "# Aufgaben-RPC"
TODAY=$(su "select (now() at time zone 'Europe/Berlin')::date")
YEAR=${TODAY%%-*}
LEAP=$((YEAR+1)); while [ $(( (LEAP%4==0 && LEAP%100!=0) || LEAP%400==0 )) -eq 0 ]; do LEAP=$((LEAP+1)); done
T1=11111111-1111-1111-1111-111111111111
mk() { su "INSERT INTO public.aufgaben(id,titel,zustaendig,faellig,wiederholung) VALUES ('$1','T $1','beide',${2:-NULL},${3:-NULL})" >/dev/null; }
succ() { su "SELECT faellig FROM public.aufgaben WHERE vorgaenger_id='$1'"; }
count() { su "SELECT count(*) FROM public.aufgaben"; }

reset; mk $T1 "'2099-01-01'"
asA "SELECT public.set_task_completion('$T1',true)" >/dev/null
expect_val "einmalig: erledigt + erledigt_am gesetzt" "t|t" "$(su "SELECT erledigt, erledigt_am IS NOT NULL FROM public.aufgaben WHERE id='$T1'")"
expect_val "einmalig: keine Folgeaufgabe" 1 "$(count)"
asA "SELECT public.set_task_completion('$T1',false)" >/dev/null
expect_val "einmalig: Undo setzt erledigt_am zurueck" "f|t" "$(su "SELECT erledigt, erledigt_am IS NULL FROM public.aufgaben WHERE id='$T1'")"

reset; mk $T1 "'2099-01-10'" "'woechentlich'"
asA "SELECT public.set_task_completion('$T1',true)" >/dev/null
expect_val "wiederkehrend: genau ein Nachfolger mit vorgaenger_id" "1|2099-01-17" "$(su "SELECT count(*), max(faellig) FROM public.aufgaben WHERE vorgaenger_id='$T1'")"
asA "SELECT public.set_task_completion('$T1',true)" >/dev/null
expect_val "wiederkehrend: erneutes Erledigen ist No-op" 2 "$(count)"

# Parallel: A haelt die Zeilensperre, B startet waehrenddessen
reset; mk $T1 "'2099-01-10'" "'taeglich'"
( asA "SELECT public.set_task_completion('$T1',true); SELECT pg_sleep(2)" >/dev/null ) &
sleep 0.7
asB "SELECT public.set_task_completion('$T1',true)" >/dev/null
wait
expect_val "parallel erledigen: maximal ein Nachfolger" 1 "$(su "SELECT count(*) FROM public.aufgaben WHERE vorgaenger_id='$T1'")"

# Undo-Regeln
reset; mk $T1 "'2099-01-10'" "'monatlich'"
asA "SELECT public.set_task_completion('$T1',true)" >/dev/null
asA "SELECT public.set_task_completion('$T1',false)" >/dev/null
expect_val "undo: unveraenderter Nachfolger geloescht" "1|f" "$(su "SELECT count(*), bool_or(erledigt) FROM public.aufgaben")"
asA "SELECT public.set_task_completion('$T1',true)" >/dev/null
expect_val "undo: erneutes Erledigen erzeugt wieder genau einen Nachfolger" 1 "$(su "SELECT count(*) FROM public.aufgaben WHERE vorgaenger_id='$T1'")"

for edit in "titel='geaendert'" "zustaendig='Luna'" "wiederholung='taeglich'" "faellig=faellig+3"; do
  reset; mk $T1 "'2099-01-10'" "'monatlich'"
  asA "SELECT public.set_task_completion('$T1',true)" >/dev/null
  su "UPDATE public.aufgaben SET $edit WHERE vorgaenger_id='$T1'" >/dev/null
  out=$(asA "SELECT public.set_task_completion('$T1',false)"); st=$?
  expect_err "undo abgelehnt, Nachfolger bearbeitet ($edit)" "undo is blocked\|changed" "$out"
  expect_val "  ... Nachfolger bleibt, Original bleibt erledigt ($edit)" "2|t" "$(su "SELECT count(*), (SELECT erledigt FROM public.aufgaben WHERE id='$T1') FROM public.aufgaben")"
done

reset; mk $T1 "'2099-01-10'" "'monatlich'"
asA "SELECT public.set_task_completion('$T1',true)" >/dev/null
C=$(su "SELECT id FROM public.aufgaben WHERE vorgaenger_id='$T1'")
asA "SELECT public.set_task_completion('$C',true)" >/dev/null
out=$(asA "SELECT public.set_task_completion('$T1',false)")
expect_err "undo abgelehnt, Nachfolger erledigt" "already completed\|descendants" "$out"
expect_val "  ... Kette unveraendert (3 Aufgaben)" 3 "$(count)"

# Datumslogik (Vergleich mit logic.js nextRecurrence)
chk() { # name faellig wdh erwartet
  reset; mk $T1 "'$2'" "'$3'"
  asA "SELECT public.set_task_completion('$T1',true)" >/dev/null
  expect_val "$1" "$4" "$(succ $T1)"
}
chk "taeglich" 2099-03-31 taeglich 2099-04-01
chk "monatlich 31.01. -> 28.02." 2099-01-31 monatlich 2099-02-28
chk "monatlich 31.03. -> 30.04." 2099-03-31 monatlich 2099-04-30
chk "monatlich 15.12. -> 15.01. (Jahreswechsel)" 2099-12-15 monatlich 2100-01-15
chk "monatlich 31.12. -> 31.01." 2099-12-31 monatlich 2100-01-31
chk "jaehrlich 28.02." 2099-02-28 jaehrlich 2100-02-28
chk "jaehrlich 29.02. (Schaltjahr) -> 28.02. im Nicht-Schaltjahr" 2096-02-29 jaehrlich 2097-02-28
chk "jaehrlich 31.12." 2099-12-31 jaehrlich 2100-12-31
reset; mk $T1 "'$LEAP-02-29'" "'jaehrlich'" 2>/dev/null
asA "SELECT public.set_task_completion('$T1',true)" >/dev/null
expect_val "jaehrlich 29.02.$LEAP -> 28.02.$((LEAP+1))" "$((LEAP+1))-02-28" "$(succ $T1)"
# Vergangenheit: Basis = heute, Tag des urspruenglichen Termins
D=$(date -d "$TODAY" +%Y-%m-01)
chk "vergangen taeglich -> heute+1" 2000-01-15 taeglich "$(date -d "$TODAY +1 day" +%F)"
chk "vergangen woechentlich -> heute+7" 2000-01-15 woechentlich "$(date -d "$TODAY +7 day" +%F)"
chk "vergangen monatlich -> Folgemonat, Tag 15" 2000-01-15 monatlich "$(date -d "$D +1 month" +%Y-%m)-15"
chk "vergangen jaehrlich -> naechstes Jahr, heutiger Monat, Tag 15" 2000-01-15 jaehrlich "$((YEAR+1))-$(date -d "$TODAY" +%m)-15"
reset; mk $T1 NULL "'monatlich'"
asA "SELECT public.set_task_completion('$T1',true)" >/dev/null
if [ "$(date -d "$TODAY" +%d)" -le 28 ]; then
  expect_val "ohne Faelligkeit: monatlich ab heute" "$(date -d "$D +1 month" +%Y-%m)-$(date -d "$TODAY" +%d)" "$(succ $T1)"
fi

# Zugriff
reset; mk $T1 "'2099-01-10'" "'monatlich'"
out=$(asX "SELECT public.set_task_completion('$T1',true)")
expect_err "Nicht-Mitglied: abgelehnt" "not found\|not accessible" "$out"
out=$(asAnon "SELECT public.set_task_completion('$T1',true)")
expect_err "anon: kein Execute-Recht" "permission denied" "$out"
expect_val "  ... unveraendert" "1|f" "$(su "SELECT count(*), bool_or(erledigt) FROM public.aufgaben")"
out=$(asA "SELECT public.set_task_completion('99999999-9999-9999-9999-999999999999',true)")
expect_err "unbekannte ID: kontrollierter Fehler" "not found" "$out"
expect_val "  ... unveraendert" "1|f" "$(su "SELECT count(*), bool_or(erledigt) FROM public.aufgaben")"
