-- Wocheneinkauf, Teil 3: Belege-Eingang. Fotos von Bons koennen ohne Betrag hinterlegt und spaeter einem Einkauf zugeordnet werden.
-- Setzt Teil 1 (einkauf_limits, einkaeufe) voraus; der Foto-Bucket (Teil 2) wird mitbenutzt.
-- Rein additiv: eine neue Tabelle, eine neue Funktion. Idempotent.

CREATE TABLE IF NOT EXISTS public.beleg_eingang (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Der Pfad ist immer <id>.jpg: kein frei waehlbarer Pfad, jede Datei gehoert zu genau einer Zeile.
  beleg_pfad text NOT NULL,
  erfasst_von text DEFAULT (auth.jwt() ->> 'email'),
  erfasst_am timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT beleg_eingang_pfad_check CHECK (beleg_pfad = id::text || '.jpg' AND beleg_pfad ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
);
CREATE UNIQUE INDEX IF NOT EXISTS beleg_eingang_pfad_key ON public.beleg_eingang (beleg_pfad);
CREATE INDEX IF NOT EXISTS beleg_eingang_erfasst_am_idx ON public.beleg_eingang (erfasst_am);

ALTER TABLE public.beleg_eingang ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nur mitglieder" ON public.beleg_eingang;
CREATE POLICY "nur mitglieder" ON public.beleg_eingang FOR ALL TO authenticated
  USING ((SELECT private.ist_mitglied())) WITH CHECK ((SELECT private.ist_mitglied()));
REVOKE ALL ON public.beleg_eingang FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.beleg_eingang FROM authenticated;
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON public.beleg_eingang FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- Ordnet einen Eingangs-Beleg als Einkauf zu: Einkauf anlegen UND Eingangszeile loeschen in einer Transaktion.
-- Wiederholung (Netzfehler, Doppeltipp, paralleler Aufruf) ist ein No-op: der Einkauf nutzt die ID des Eingangs.
CREATE OR REPLACE FUNCTION public.beleg_zuordnen(
  p_eingang_id uuid, p_limit_id uuid, p_datum date, p_betrag numeric, p_notiz text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_pfad text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_eingang_id IS NULL OR p_limit_id IS NULL OR p_datum IS NULL OR p_betrag IS NULL THEN
    RAISE EXCEPTION 'Missing values';
  END IF;
  SELECT beleg_pfad INTO v_pfad FROM public.beleg_eingang WHERE id = p_eingang_id FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.einkaeufe WHERE id = p_eingang_id) THEN RETURN; END IF; -- bereits zugeordnet
    RAISE EXCEPTION 'Receipt not found or not accessible';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.einkauf_limits WHERE id = p_limit_id AND aktiv) THEN
    RAISE EXCEPTION 'Limit not found or inactive';
  END IF;
  INSERT INTO public.einkaeufe (id, limit_id, datum, betrag, notiz, beleg_pfad)
  VALUES (p_eingang_id, p_limit_id, p_datum, p_betrag, NULLIF(btrim(p_notiz), ''), v_pfad);
  DELETE FROM public.beleg_eingang WHERE id = p_eingang_id;
END;
$$;
REVOKE ALL ON FUNCTION public.beleg_zuordnen(uuid, uuid, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.beleg_zuordnen(uuid, uuid, date, numeric, text) TO authenticated;
