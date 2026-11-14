-- ROLLBACK von 20261114200200: nur der funktionale Teil. Stellt authenticated UPDATE/DELETE auf bankumsaetze her.
-- Die entzogenen TRUNCATE/REFERENCES/TRIGGER-Rechte und die anon-Rechte werden bewusst NICHT zurueckgegeben:
-- Sie sind eine Schwachstelle, kein Feature. Nur ausfuehren, wenn eine App-Funktion UPDATE/DELETE braucht.
BEGIN;
GRANT UPDATE, DELETE ON public.bankumsaetze TO authenticated;
COMMIT;
