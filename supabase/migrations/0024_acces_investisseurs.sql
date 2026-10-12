-- =====================================================================
-- HENZO – Accès des investisseurs (lecture seule)
-- Un compte « investisseur » est relié à une fiche investisseur. Il voit
-- uniquement : son capital, ce qui est placé dans chaque bande (code,
-- dates, statut), ses 10 % (en attente, versés, réinvestis) et ses
-- opérations. Rien d'autre de la ferme : ni caisses, ni ventes, ni clients.
--   * ferme_actuelle() renvoie NULL pour un investisseur : toutes les règles
--     « données de la ferme » le refusent automatiquement ;
--   * des règles dédiées lui ouvrent seulement ses propres lignes.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 0023 (lancé seul).
-- =====================================================================

alter table public.investisseurs add column profile_id uuid unique references public.profiles (id);

-- Ferme active : jamais pour un compte investisseur (il ne voit pas les données de la ferme)
create or replace function public.ferme_actuelle()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ferme_id from public.profiles where id = auth.uid() and actif and role::text <> 'investisseur'
$$;

-- Fiche investisseur du compte connecté
create function public.mon_investisseur()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.id from public.investisseurs i join public.profiles p on p.id = i.profile_id
  where i.profile_id = auth.uid() and p.actif and p.role::text = 'investisseur'
  limit 1
$$;
grant execute on function public.mon_investisseur() to authenticated;

-- Ses propres lignes uniquement (règles ajoutées aux règles existantes)
create policy investisseur_soi on public.investisseurs for select to authenticated
  using (id = public.mon_investisseur());
create policy investisseur_operations on public.operations_investisseurs for select to authenticated
  using (investisseur_id = public.mon_investisseur());
create policy investisseur_distributions on public.distributions_investisseurs for select to authenticated
  using (investisseur_id = public.mon_investisseur());
create policy investisseur_capital_bandes on public.capital_bandes for select to authenticated
  using (investisseur_id = public.mon_investisseur() and not annulee);
-- Les bandes où son capital est placé (code, dates, statut)
create policy investisseur_bandes on public.bandes for select to authenticated
  using (exists (select 1 from public.capital_bandes c
                 where c.bande_id = bandes.id and c.investisseur_id = public.mon_investisseur() and not c.annulee));
-- Le nom de la ferme et le taux (pour son relevé)
create policy investisseur_ferme on public.fermes for select to authenticated
  using (id = (select ferme_id from public.investisseurs where id = public.mon_investisseur()));

-- Relier un compte (rôle investisseur) à une fiche investisseur — directeur
create function public.lier_compte_investisseur(p_investisseur uuid, p_identifiant text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur relie un compte investisseur'; end if;
  if not exists (select 1 from public.investisseurs where id = p_investisseur and ferme_id = public.ferme_actuelle()) then
    raise exception 'Investisseur introuvable';
  end if;
  select id into v_user from public.profiles where lower(identifiant) = lower(trim(p_identifiant)) and role::text = 'investisseur';
  if v_user is null then raise exception 'Aucun compte investisseur avec l''identifiant %', p_identifiant; end if;
  update public.investisseurs set profile_id = null where profile_id = v_user;
  update public.investisseurs set profile_id = v_user where id = p_investisseur;
end;
$$;
grant execute on function public.lier_compte_investisseur(uuid, text) to authenticated;
revoke execute on function public.mon_investisseur(), public.lier_compte_investisseur(uuid, text) from anon;
