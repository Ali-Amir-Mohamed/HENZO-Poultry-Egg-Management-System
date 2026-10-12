-- =====================================================================
-- HENZO – Annuler les comptes investisseurs (0023 / 0024)
-- À lancer SEULEMENT si 0024 a déjà été exécutée dans Supabase.
-- (Si seule 0023 a été lancée, il n'y a rien à faire : le rôle
--  « investisseur » reste dans la liste mais n'est utilisé nulle part.)
-- =====================================================================

drop policy if exists investisseur_soi on public.investisseurs;
drop policy if exists investisseur_operations on public.operations_investisseurs;
drop policy if exists investisseur_distributions on public.distributions_investisseurs;
drop policy if exists investisseur_capital_bandes on public.capital_bandes;
drop policy if exists investisseur_bandes on public.bandes;
drop policy if exists investisseur_ferme on public.fermes;
drop function if exists public.lier_compte_investisseur(uuid, text);
drop function if exists public.mon_investisseur();
alter table public.investisseurs drop column if exists profile_id;

-- Ferme active : de nouveau pour tous les comptes actifs
create or replace function public.ferme_actuelle()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ferme_id from public.profiles where id = auth.uid() and actif
$$;
