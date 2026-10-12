-- =====================================================================
-- HENZO – Comptes bancaires : la finance (Dahirou) y a accès aussi
--   Le directeur et la finance voient, ajoutent et modifient les comptes
--   bancaires de l'entreprise. Le reste de l'Administration (documents,
--   échéances, terrains) reste réservé au directeur.
-- À exécuter une fois dans Supabase > SQL Editor, après 0030.
-- =====================================================================

drop policy if exists admin_comptes_all on public.admin_comptes_bancaires;
create policy admin_comptes_all on public.admin_comptes_bancaires for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));
