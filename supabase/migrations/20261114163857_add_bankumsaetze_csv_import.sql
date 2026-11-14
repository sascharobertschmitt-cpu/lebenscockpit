-- Nachgezogene Kopie einer bereits in Produktion angewendeten Migration (Version 20261114163857).
-- Wortgleich aus supabase_migrations.schema_migrations uebernommen, damit das Repo die Tabelle
-- reproduzieren kann und die lokale Migrationsliste zur Remote-Historie passt. Nicht erneut anwenden.
create table if not exists public.bankumsaetze (
 id bigint generated always as identity primary key,
 konto text not null check (konto in ('sascha','luna')),
 buchungsdatum date not null,
 betrag numeric(14,2) not null,
 verwendungszweck text not null default '',
 gegenpartei text not null default '',
 import_key text not null,
 importiert_am timestamptz not null default now(),
 unique (konto,import_key)
);
alter table public.bankumsaetze enable row level security;
create policy "nur mitglieder" on public.bankumsaetze for all to authenticated using ((select private.ist_mitglied())) with check ((select private.ist_mitglied()));
grant select, insert on public.bankumsaetze to authenticated;
create index if not exists bankumsaetze_konto_datum_idx on public.bankumsaetze (konto,buchungsdatum desc);
