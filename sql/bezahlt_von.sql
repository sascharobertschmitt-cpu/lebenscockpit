-- Zahlungsquelle je Ausgabe: sascha (Saschas Konto/Karte), luna (Lunas Konto/Karte), bar.
-- Default sascha aus Kompatibilitätsgründen für bestehende Zeilen.
alter table public.wochenausgaben
 add column bezahlt_von text not null default 'sascha'
 check (bezahlt_von in ('sascha', 'luna', 'bar'));
