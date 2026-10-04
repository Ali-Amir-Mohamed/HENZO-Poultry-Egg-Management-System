-- =====================================================================
-- HENZO – Stock d'œufs visible par tous (alerte à la vente) et
-- comptes limités à la ferme active (plusieurs fermes)
-- À exécuter une fois dans Supabase > SQL Editor, après 0013.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Stock d'œufs : aussi visible par les employés, qui vendent des œufs
--    (le formulaire de vente prévient si on vend plus que le stock)
-- ---------------------------------------------------------------------
create or replace view public.stock_oeufs as
with f as (select id, oeufs_par_plateau as opp from public.fermes where id = public.ferme_actuelle()),
calc as (
  select f.opp,
         coalesce((select sum(oeufs_collectes - oeufs_casses) from public.pontes p where p.ferme_id = f.id), 0) as oeufs_bons,
         coalesce((select sum(case v.produit when 'oeufs' then v.quantite when 'plateaux' then v.quantite * f.opp end)
                   from public.ventes v where v.ferme_id = f.id and not v.annulee and v.produit in ('oeufs', 'plateaux')), 0) as oeufs_vendus,
         coalesce((select sum(quantite) from public.ajustements_oeufs a where a.ferme_id = f.id), 0) as ajustements
  from f
)
select oeufs_bons::integer, oeufs_vendus::integer, ajustements::integer,
       (oeufs_bons - oeufs_vendus + ajustements)::integer as stock_oeufs,
       floor((oeufs_bons - oeufs_vendus + ajustements) / opp)::integer as plateaux,
       mod((oeufs_bons - oeufs_vendus + ajustements)::integer, opp) as oeufs_isoles,
       opp as oeufs_par_plateau
from calc
where public.role_actuel() is not null;
revoke all on public.stock_oeufs from anon;

-- ---------------------------------------------------------------------
-- 2. Comptes : le directeur voit et gère les comptes membres de la ferme
--    active (y compris ceux qui travaillent en ce moment dans une autre
--    ferme), et seulement ceux-là
-- ---------------------------------------------------------------------
create function public.membre_ferme_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.membres_fermes where user_id = p_user and ferme_id = public.ferme_actuelle())
$$;
grant execute on function public.membre_ferme_active(uuid) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (public.a_role('directeur') and public.membre_ferme_active(id)));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.a_role('directeur') and public.membre_ferme_active(id))
  with check (public.a_role('directeur') and public.membre_ferme_active(id));
