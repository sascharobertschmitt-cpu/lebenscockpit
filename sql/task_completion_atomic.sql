-- Apply only after reviewing against the live schema and RLS policies.
ALTER TABLE public.aufgaben
  ADD COLUMN IF NOT EXISTS vorgaenger_id uuid REFERENCES public.aufgaben(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS aufgaben_one_successor
  ON public.aufgaben(vorgaenger_id) WHERE vorgaenger_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_task_completion(p_task_id uuid, p_done boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_task public.aufgaben%ROWTYPE;
  v_child public.aufgaben%ROWTYPE;
  v_next date;
  v_base date;
BEGIN
  SELECT * INTO v_task FROM public.aufgaben WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found or not accessible'; END IF;
  IF v_task.erledigt = p_done THEN RETURN; END IF;

  IF v_task.wiederholung IS NOT NULL THEN
    SELECT * INTO v_child FROM public.aufgaben WHERE vorgaenger_id = p_task_id FOR UPDATE;
    IF p_done THEN
      IF NOT FOUND THEN
        v_base := GREATEST(COALESCE(v_task.faellig, CURRENT_DATE), CURRENT_DATE);
        CASE v_task.wiederholung
          WHEN 'taeglich' THEN v_next := v_base + 1;
          WHEN 'woechentlich' THEN v_next := v_base + 7;
          WHEN 'monatlich' THEN
            v_next := (date_trunc('month', v_base)::date + interval '1 month')::date
              + (LEAST(EXTRACT(day FROM COALESCE(v_task.faellig, v_base))::int,
                  EXTRACT(day FROM ((date_trunc('month', v_base) + interval '2 month - 1 day')::date))::int) - 1);
          WHEN 'jaehrlich' THEN
            v_next := make_date(EXTRACT(year FROM v_base)::int + 1,
              EXTRACT(month FROM v_base)::int,
              LEAST(EXTRACT(day FROM COALESCE(v_task.faellig, v_base))::int,
                EXTRACT(day FROM (date_trunc('month', v_base + interval '1 year') + interval '1 month - 1 day')::date)::int));
          ELSE RAISE EXCEPTION 'Unknown recurrence';
        END CASE;
        INSERT INTO public.aufgaben(titel,zustaendig,faellig,wiederholung,vorgaenger_id)
        VALUES(v_task.titel,v_task.zustaendig,v_next,v_task.wiederholung,p_task_id);
      END IF;
    ELSE
      IF FOUND THEN
        IF v_child.erledigt THEN RAISE EXCEPTION 'Successor already completed'; END IF;
        DELETE FROM public.aufgaben WHERE id = v_child.id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Successor could not be deleted'; END IF;
      END IF;
    END IF;
  END IF;
  UPDATE public.aufgaben SET erledigt=p_done,
    erledigt_am=CASE WHEN p_done THEN now() ELSE NULL END
  WHERE id=p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task update failed'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_task_completion(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_task_completion(uuid,boolean) TO authenticated;
