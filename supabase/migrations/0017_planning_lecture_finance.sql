-- =====================================================================
-- HENZO – La finance consulte le planning mais ne programme pas
-- Créer, reporter, annuler une tâche : directeur et exploitation.
-- La finance peut seulement cocher « Fait » les tâches qui lui sont
-- assignées (ex. un remboursement de prêt).
-- À exécuter une fois dans Supabase > SQL Editor, après 0016.
-- =====================================================================

drop policy if exists taches_insert on public.taches;
create policy taches_insert on public.taches for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));

drop policy if exists taches_update on public.taches;
create policy taches_update on public.taches for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation'));

drop policy if exists realisations_insert on public.taches_realisations;
create policy realisations_insert on public.taches_realisations for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid()
              and (not public.a_role('finance')
                   or exists (select 1 from public.taches t where t.id = tache_id and t.assigne_role = 'finance')));
