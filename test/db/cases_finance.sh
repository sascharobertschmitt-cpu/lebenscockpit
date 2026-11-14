# Finanz-RPC save_account_reconciliation
echo "# Finanz-RPC"
P1=aaaaaaaa-0000-0000-0000-000000000001; P2=aaaaaaaa-0000-0000-0000-000000000002; PBAR=aaaaaaaa-0000-0000-0000-000000000003
TS="2026-11-14 08:30:00+01"
fx() { reset; su "INSERT INTO public.posten(id,name,betrag,zahlung) VALUES ('$P1','Miete',1150,'konto'),('$P2','Abo',9.99,'konto'),('$PBAR','Bar',20,'bar')" >/dev/null; }
pay() { # posten betrag [ts]
  echo "{\"posten_id\":\"$1\",\"finanzmonat\":\"2026-11-01\",\"betrag\":$2,\"bezahlt_am\":\"2026-11-02\",\"erfasst_am\":\"${3:-$TS}\"}"; }
rec() { # asFn email konto json
  echo "SELECT public.save_account_reconciliation(2500.50, '$TS', '$2', '$3', '$4'::jsonb)"; }
state() { su "SELECT (SELECT count(*) FROM public.kontostaende)||'|'||(SELECT count(*) FROM public.posten_zahlungen)"; }

fx; asA "$(rec x a@example.test sascha '[]')" >/dev/null
expect_val "ohne Zahlungen: genau ein Kontostand" "1|0" "$(state)"
expect_val "  ... Werte korrekt" "2500.50|a@example.test|sascha" "$(su "SELECT betrag,erfasst_von,konto FROM public.kontostaende")"
fx; asA "$(rec x a@example.test sascha "[$(pay $P1 1150),$(pay $P2 9.99)]")" >/dev/null
expect_val "zwei gueltige Zahlungen: Kontostand + beide Zahlungen" "1|2" "$(state)"
fx; asA "$(rec x a@example.test luna '[]')" >/dev/null
expect_val "luna ohne Zahlungen erlaubt" "1|0" "$(state)"

neg() { # name pattern email konto json
  fx
  out=$(asA "$(rec x "$3" "$4" "$5")")
  expect_err "$1" "$2" "$out"
  expect_val "  ... Rollback, nichts gespeichert" "0|0" "$(state)"
}
neg "eine ungueltige Zahlung in Liste" "amount changed" a@example.test sascha "[$(pay $P1 1150),$(pay $P2 1.00)]"
neg "unbekannte Posten-ID" "not accessible" a@example.test sascha "[$(pay $P1 1150),$(pay 99999999-9999-9999-9999-999999999999 5)]"
neg "abweichender Postenbetrag" "amount changed" a@example.test sascha "[$(pay $P1 1149.99)]"
neg "Barzahlung im Kontoabgleich" "Cash item" a@example.test sascha "[$(pay $P1 1150),$(pay $PBAR 20)]"
neg "luna mit Zahlungen" "Luna balance" a@example.test luna "[$(pay $P1 1150)]"
neg "E-Mail passt nicht zum JWT" "must match" b@example.test sascha '[]'
neg "ungueltiges Konto" "Invalid account" a@example.test fremd '[]'
neg "JSON ist kein Array" "Invalid payments" a@example.test sascha '{"a":1}'
neg "JSON null" "Invalid payments" a@example.test sascha 'null'
neg "fehlender Wert (bezahlt_am)" "Incomplete" a@example.test sascha "[{\"posten_id\":\"$P1\",\"finanzmonat\":\"2026-11-01\",\"betrag\":1150,\"erfasst_am\":\"$TS\"}]"
neg "Zahlung kein Objekt" "Incomplete" a@example.test sascha '["x"]'
neg "ungueltige UUID" "invalid input" a@example.test sascha "[{\"posten_id\":\"kaputt\",\"finanzmonat\":\"2026-11-01\",\"betrag\":1,\"bezahlt_am\":\"2026-11-02\",\"erfasst_am\":\"$TS\"}]"
neg "abweichender Zahlungs-Zeitstempel" "Timestamp mismatch" a@example.test sascha "[$(pay $P1 1150 '2026-11-14 09:00:00+01')]"
fx
out=$(asA "SELECT public.save_account_reconciliation(NULL,'$TS','a@example.test','sascha','[]')")
expect_err "NULL-Betrag abgelehnt" "Missing balance" "$out"
expect_val "  ... nichts gespeichert" "0|0" "$(state)"

fx
out=$(asX "$(rec x x@example.test sascha '[]')")
expect_err "Nicht-Mitglied: RLS blockt" "row-level security" "$out"
expect_val "  ... nichts gespeichert" "0|0" "$(state)"
fx
out=$(asX "$(rec x x@example.test sascha "[$(pay $P1 1150)]")")
expect_err "Nicht-Mitglied mit Zahlung: abgelehnt" "not accessible\|row-level" "$out"
expect_val "  ... nichts gespeichert" "0|0" "$(state)"
out=$(asAnon "$(rec x a@example.test sascha '[]')")
expect_err "anon: kein Execute-Recht" "permission denied" "$out"
out=$(psql -qX -tA 2>&1 <<SQL
BEGIN; SET LOCAL ROLE authenticated; SELECT public.save_account_reconciliation(1,'$TS','a@example.test','sascha','[]'); ROLLBACK;
SQL
)
expect_err "authenticated ohne JWT: abgelehnt" "Authentication required\|invalid input" "$out"

# Parallel: zwei identische Abgleiche gleichzeitig
fx
( asA "$(rec x a@example.test sascha "[$(pay $P1 1150)]")" >/dev/null ) &
( asA "$(rec x a@example.test sascha "[$(pay $P1 1150)]")" >/dev/null ) &
wait
expect_val "parallel: genau eine Zahlung je Posten+Monat (Upsert), kein Fehler" 1 "$(su "SELECT count(*) FROM public.posten_zahlungen")"
# Bekanntes, dokumentiertes Verhalten: Wiederholung legt weiteren Kontostand an (nicht idempotent).
expect_val "parallel: zwei Kontostaende (dokumentiertes Verhalten, nicht idempotent)" 2 "$(su "SELECT count(*) FROM public.kontostaende")"
