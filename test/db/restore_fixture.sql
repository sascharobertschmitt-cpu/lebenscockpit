-- Produktionsnahes, rein SYNTHETISCHES Schema fuer den Backup/Restore-Test.
-- Spalten, Checks, Unique-/FK-Constraints, Indizes, RLS-Policies und private.ist_mitglied()
-- sind den Katalog-Metadaten des Produktivprojekts nachgebildet (Stand 14.11.2026, ohne Daten).
-- Der Funktionsrumpf von private.ist_mitglied() ist eine Nachbildung (E-Mail aus auth.jwt()
-- gegen mitglieder.email), nicht der Originaltext.
-- Voraussetzung: supabase_stub.sql wurde vorher eingespielt.
\set ON_ERROR_STOP on

CREATE TABLE public.mitglieder (email text PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.einnahmen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person text NOT NULL, betrag numeric NOT NULL,
  tag_im_monat integer NOT NULL CHECK (tag_im_monat >= 1 AND tag_im_monat <= 31),
  aktiv boolean NOT NULL DEFAULT true, gueltig_ab date, gueltig_bis date, notiz text);
CREATE TABLE public.posten (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, betrag numeric NOT NULL,
  tag_im_monat integer CHECK (tag_im_monat >= 1 AND tag_im_monat <= 31), tag_hinweis text,
  rhythmus text NOT NULL DEFAULT 'monatlich' CHECK (rhythmus IN ('monatlich','jaehrlich','einmalig')),
  kategorie text NOT NULL DEFAULT 'sonstiges' CHECK (kategorie IN ('rate','versicherung','abo','wohnen','sonstiges')),
  zahlung text NOT NULL DEFAULT 'konto' CHECK (zahlung IN ('konto','bar')),
  status text NOT NULL DEFAULT 'sicher' CHECK (status IN ('sicher','pruefen')),
  gueltig_ab date, gueltig_bis date, notiz text, faellig_am date);
CREATE TABLE public.posten_zahlungen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posten_id uuid NOT NULL,
  finanzmonat date NOT NULL, betrag numeric NOT NULL,
  bezahlt_am date NOT NULL DEFAULT CURRENT_DATE,
  erfasst_am timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posten_zahlungen_posten_id_fkey FOREIGN KEY (posten_id)
    REFERENCES public.posten(id) ON DELETE CASCADE,
  CONSTRAINT posten_zahlungen_posten_id_finanzmonat_key UNIQUE (posten_id, finanzmonat));
CREATE INDEX posten_zahlungen_posten_id_idx ON public.posten_zahlungen (posten_id);
CREATE TABLE public.kontostaende (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  erfasst_am timestamptz NOT NULL DEFAULT now(), betrag numeric NOT NULL,
  erfasst_von text, notiz text,
  konto text NOT NULL DEFAULT 'sascha' CHECK (konto IN ('sascha','luna')));
CREATE INDEX kontostaende_erfasst_am_idx ON public.kontostaende (erfasst_am DESC);
CREATE TABLE public.aufgaben (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), titel text NOT NULL,
  zustaendig text CHECK (zustaendig IN ('Sascha','Luna','beide')), faellig date,
  wiederholung text CHECK (wiederholung IN ('taeglich','woechentlich','monatlich','jaehrlich')),
  erledigt boolean NOT NULL DEFAULT false, erledigt_am timestamptz,
  erstellt_am timestamptz NOT NULL DEFAULT now());
CREATE INDEX aufgaben_erledigt_faellig_idx ON public.aufgaben (erledigt, faellig);

CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO authenticated;
CREATE FUNCTION private.ist_mitglied() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.mitglieder m WHERE m.email = (auth.jwt() ->> 'email'))
$$;
REVOKE ALL ON FUNCTION private.ist_mitglied() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.ist_mitglied() TO authenticated;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mitglieder','einnahmen','posten','posten_zahlungen','kontostaende','aufgaben'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF t <> 'mitglieder' THEN
      EXECUTE format('CREATE POLICY "nur mitglieder" ON public.%I FOR ALL TO authenticated '
                     'USING (private.ist_mitglied()) WITH CHECK (private.ist_mitglied())', t);
    END IF;
  END LOOP;
END $$;

-- Synthetische Daten mit Grenzwerten: Umlaute, NULLs, Nachkommastellen, negative Betraege,
-- Schalttag, Zeitzonen, Monatsende. Feste UUIDs fuer reproduzierbare Pruefsummen.
INSERT INTO public.mitglieder VALUES
  ('mitglied-a@example.test', 'Testperson Ä'), ('mitglied-b@example.test', 'Testperson Ö');
INSERT INTO public.einnahmen VALUES
  ('10000000-0000-0000-0000-000000000001', 'A', 3210.55, 31, true, '2024-02-29', NULL, 'Gehalt "brutto"; netto'),
  ('10000000-0000-0000-0000-000000000002', 'B', 0.01, 1, false, NULL, '2026-12-31', NULL);
INSERT INTO public.posten (id, name, betrag, tag_im_monat, rhythmus, kategorie, zahlung, status, faellig_am, notiz) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Miete Wohnung', 1150.00, 1, 'monatlich', 'wohnen', 'konto', 'sicher', NULL, 'Zeile1' || chr(10) || 'Zeile2'),
  ('20000000-0000-0000-0000-000000000002', 'Kfz-Versicherung', 487.13, 15, 'jaehrlich', 'versicherung', 'konto', 'pruefen', NULL, NULL),
  ('20000000-0000-0000-0000-000000000003', 'Einmalig ohne Historie', 99.99, NULL, 'einmalig', 'sonstiges', 'bar', 'sicher', '2026-11-30', NULL),
  ('20000000-0000-0000-0000-000000000004', 'Gutschrift', -12.345, 28, 'monatlich', 'sonstiges', 'konto', 'sicher', NULL, 'ß€');
INSERT INTO public.posten_zahlungen VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026-10-01', 1150.00, '2026-10-01', '2026-10-01 00:00:00+02'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '2026-11-01', 1150.00, '2026-11-02', '2026-11-02 23:59:59.999999+01'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '2026-01-01', 487.13, '2026-01-15', '2026-01-15 12:00:00+00');
INSERT INTO public.kontostaende VALUES
  ('40000000-0000-0000-0000-000000000001', '2026-11-14 08:30:00+01', 2345.67, 'mitglied-a@example.test', NULL, 'sascha'),
  ('40000000-0000-0000-0000-000000000002', '2026-11-14 08:31:00+01', -150.00, 'mitglied-b@example.test', 'Dispo', 'luna');
INSERT INTO public.aufgaben VALUES
  ('50000000-0000-0000-0000-000000000001', 'Steuer', 'beide', '2026-12-31', 'jaehrlich', false, NULL, '2026-11-01 10:00:00+01'),
  ('50000000-0000-0000-0000-000000000002', 'Erledigt', 'Luna', NULL, NULL, true, '2026-11-10 09:00:00+01', '2026-11-01 10:00:00+01');
