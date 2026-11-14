-- Produktionsnahes, rein SYNTHETISCHES Schema fuer den Backup/Restore-Test.
-- Spalten, Checks, Unique-/FK-Constraints, Indizes, RLS-Policies und private.ist_mitglied()
-- sind den Katalog-Metadaten des Produktivprojekts nachgebildet (Stand 14.11.2026, ohne Daten).
-- private.ist_mitglied() entspricht dem Produktivtext (pg_get_functiondef, 14.11.2026):
-- Vergleich ohne Beachtung der Gross-/Kleinschreibung. bankumsaetze ist nur fuer die Vollstaendigkeit
-- enthalten (DDL wortgleich aus der Produktivmigration 20261114163857); die RPCs beruehren sie nicht.
-- Voraussetzung: supabase_stub.sql wurde vorher eingespielt.
-- Nur Schema, keine Daten (Daten-Fixtures liegen im Test selbst).
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

CREATE TABLE public.bankumsaetze (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  konto text NOT NULL CHECK (konto IN ('sascha','luna')),
  buchungsdatum date NOT NULL, betrag numeric(14,2) NOT NULL,
  verwendungszweck text NOT NULL DEFAULT '', gegenpartei text NOT NULL DEFAULT '',
  import_key text NOT NULL, importiert_am timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bankumsaetze_konto_import_key_key UNIQUE (konto, import_key));
CREATE INDEX bankumsaetze_konto_datum_idx ON public.bankumsaetze (konto, buchungsdatum DESC);

CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO authenticated;
CREATE FUNCTION private.ist_mitglied() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.mitglieder m WHERE lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
REVOKE ALL ON FUNCTION private.ist_mitglied() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.ist_mitglied() TO authenticated;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mitglieder','einnahmen','posten','posten_zahlungen','kontostaende','aufgaben','bankumsaetze'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF t <> 'mitglieder' THEN
      EXECUTE format('CREATE POLICY "nur mitglieder" ON public.%I FOR ALL TO authenticated '
                     'USING (private.ist_mitglied()) WITH CHECK (private.ist_mitglied())', t);
    END IF;
  END LOOP;
END $$;

