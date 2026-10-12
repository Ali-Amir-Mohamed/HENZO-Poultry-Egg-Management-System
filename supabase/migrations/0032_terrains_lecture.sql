-- =====================================================================
-- HENZO – Terrains : Kenfack (exploitation) et Dahirou (finance) les voient
--   Lecture seule pour eux ; seul le directeur ajoute, modifie ou supprime.
--   Les documents liés aux terrains restent réservés au directeur.
-- À exécuter une fois dans Supabase > SQL Editor, après 0031.
-- =====================================================================

drop policy if exists admin_terrains_all on public.admin_terrains;
create policy admin_terrains_select on public.admin_terrains for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance', 'exploitation'));
create policy admin_terrains_insert on public.admin_terrains for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));
create policy admin_terrains_update on public.admin_terrains for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));
create policy admin_terrains_delete on public.admin_terrains for delete to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));
