-- Additive extension; existing posten RLS and grants remain in force.
alter table public.posten
 add column raten_gesamt integer,
 add column raten_ab_nummer integer,
 add column raten_ab_datum date,
 add column raten_schlussbetrag numeric(12,2),
 add constraint posten_ratenplan_valid check (
 (raten_gesamt is null and raten_ab_nummer is null and raten_ab_datum is null and raten_schlussbetrag is null)
 or (raten_gesamt is not null and raten_ab_nummer is not null and raten_ab_datum is not null and raten_schlussbetrag is not null
 and rhythmus = 'monatlich' and raten_gesamt between 1 and 600 and raten_ab_nummer between 1 and raten_gesamt and raten_schlussbetrag >= 0)
 );
