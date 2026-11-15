alter table public.posten add column raten_betraege jsonb,
add constraint posten_raten_betraege_object check (raten_betraege is null or (jsonb_typeof(raten_betraege)='object' and raten_gesamt is not null));
