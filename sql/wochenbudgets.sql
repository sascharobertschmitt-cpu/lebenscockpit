-- Wochenbudgets und Ausgaben. Zugriff wie bei den übrigen Tabellen nur für Mitglieder.
create table public.wochenbudgets (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) > 0),
 betrag numeric(12,2) not null check (betrag >= 0),
 sortierung integer not null default 0,
 aktiv boolean not null default true,
 erstellt_am timestamptz not null default now()
);
create table public.wochenausgaben (
 id uuid primary key default gen_random_uuid(),
 budget_id uuid not null references public.wochenbudgets(id) on delete cascade,
 betrag numeric(12,2) not null check (betrag > 0),
 datum date not null default current_date,
 notiz text,
 erfasst_von text,
 erfasst_am timestamptz not null default now()
);
create index wochenausgaben_datum_idx on public.wochenausgaben (datum);
alter table public.wochenbudgets enable row level security;
alter table public.wochenausgaben enable row level security;
create policy "nur mitglieder" on public.wochenbudgets for all using (private.ist_mitglied()) with check (private.ist_mitglied());
create policy "nur mitglieder" on public.wochenausgaben for all using (private.ist_mitglied()) with check (private.ist_mitglied());
revoke all on public.wochenbudgets, public.wochenausgaben from anon;
insert into public.wochenbudgets (name, betrag, sortierung) values
 ('Lebensmittel & Getränke', 80, 1), ('Katzenfutter', 10, 2), ('Sprit', 30, 3);

-- Zahlungsquelle der Ausgabe: Saschas Konto, Lunas Konto oder bar.
alter table public.wochenausgaben add column bezahlt_von text not null default 'sascha' check (bezahlt_von in ('sascha','luna','bar'));
