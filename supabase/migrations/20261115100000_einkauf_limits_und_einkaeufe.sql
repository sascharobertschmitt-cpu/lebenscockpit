-- Wocheneinkauf, Teil 1/2: Tabellen fuer selbst einstellbare Wochenlimits und erfasste Einkaeufe.
-- Rein additiv (zwei neue Tabellen), idempotent, keine bestehende Tabelle wird angefasst.
-- Rechte wie bei den uebrigen Tabellen: nur Mitglieder (RLS), anon ohne Zugriff, kein TRUNCATE/REFERENCES/TRIGGER.
-- Beleg-Fotos: Teil 2/2 (20261115100100_belege_storage.sql). Ablauf und Rollback: docs/wocheneinkauf.md

CREATE TABLE IF NOT EXISTS public.einkauf_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  wochenlimit numeric(10,2) NOT NULL CHECK (wochenlimit > 0 AND wochenlimit <= 100000),
  aktiv boolean NOT NULL DEFAULT true,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS einkauf_limits_name_key ON public.einkauf_limits (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.einkaeufe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: ein Limit mit Einkaeufen wird deaktiviert, nicht geloescht; die Historie bleibt nachvollziehbar.
  limit_id uuid NOT NULL REFERENCES public.einkauf_limits(id) ON DELETE RESTRICT,
  datum date NOT NULL,
  betrag numeric(10,2) NOT NULL CHECK (betrag > 0 AND betrag <= 100000),
  notiz text CHECK (notiz IS NULL OR char_length(notiz) <= 200),
  -- Pfad im privaten Bucket "belege": <uuid>.jpg (Format erzwungen, kein Pfadtrick moeglich)
  beleg_pfad text CHECK (beleg_pfad IS NULL OR beleg_pfad ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  erfasst_von text DEFAULT (auth.jwt() ->> 'email'),
  erfasst_am timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS einkaeufe_beleg_pfad_key ON public.einkaeufe (beleg_pfad) WHERE beleg_pfad IS NOT NULL;
CREATE INDEX IF NOT EXISTS einkaeufe_datum_idx ON public.einkaeufe (datum DESC);
CREATE INDEX IF NOT EXISTS einkaeufe_limit_id_idx ON public.einkaeufe (limit_id);

ALTER TABLE public.einkauf_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.einkaeufe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nur mitglieder" ON public.einkauf_limits;
CREATE POLICY "nur mitglieder" ON public.einkauf_limits FOR ALL TO authenticated
  USING ((SELECT private.ist_mitglied())) WITH CHECK ((SELECT private.ist_mitglied()));
DROP POLICY IF EXISTS "nur mitglieder" ON public.einkaeufe;
CREATE POLICY "nur mitglieder" ON public.einkaeufe FOR ALL TO authenticated
  USING ((SELECT private.ist_mitglied())) WITH CHECK ((SELECT private.ist_mitglied()));

REVOKE ALL ON public.einkauf_limits, public.einkaeufe FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.einkauf_limits, public.einkaeufe FROM authenticated;
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON public.einkauf_limits, public.einkaeufe FROM PUBLIC, anon, authenticated';
  END IF;
END $$;
