-- DRAFT: Apply only after staging verification and explicit production approval.
create table if not exists public.belege (
 id uuid primary key default gen_random_uuid(),
 storage_pfad text not null unique,
 dateiname text not null,
 mime_typ text not null check (mime_typ in ('application/pdf','image/jpeg','image/png','image/webp')),
 dateigroesse bigint not null check (dateigroesse > 0 and dateigroesse <= 10485760),
 posten_id uuid references public.posten(id) on delete set null,
 zahlung_id uuid references public.posten_zahlungen(id) on delete set null,
 bankumsatz_id bigint references public.bankumsaetze(id) on delete set null,
 hochgeladen_von uuid not null default auth.uid(),
 erstellt_am timestamptz not null default now(),
 constraint belege_storage_pfad_format check (storage_pfad ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'),
 constraint belege_pfad_eigentuemer check (split_part(storage_pfad,'/',1) = hochgeladen_von::text)
);
create index if not exists belege_posten_idx on public.belege(posten_id);
create index if not exists belege_zahlung_idx on public.belege(zahlung_id);
create index if not exists belege_bankumsatz_idx on public.belege(bankumsatz_id);
alter table public.belege enable row level security;
create policy "belege_lesen_mitglieder" on public.belege for select to authenticated using ((select private.ist_mitglied()));
create policy "belege_anlegen_mitglieder" on public.belege for insert to authenticated
 with check ((select private.ist_mitglied()) and hochgeladen_von = (select auth.uid()));
-- Intentionally no update/delete policy: receipt metadata is append-only pending retention policy.
grant select,insert on public.belege to authenticated;
