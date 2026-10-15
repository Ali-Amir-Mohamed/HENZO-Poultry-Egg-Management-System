-- =====================================================================
-- HENZO – Portail : choisir le site d'élevage avant la connexion
--   Avant de se connecter, le portail affiche le NOM des sites d'élevage
--   (et rien d'autre) pour demander « Quel site ? ». Après la connexion,
--   on n'entre que dans un site dont le compte est membre.
-- À exécuter une fois dans Supabase > SQL Editor, après 0039.
-- =====================================================================

create function public.portail_sites()
returns table (ferme_id uuid, nom text)
language sql
stable
security definer
set search_path = ''
as $$
  select id, nom from public.fermes where type_activite = 'elevage' order by created_at
$$;

revoke execute on function public.portail_sites() from public;
grant execute on function public.portail_sites() to anon, authenticated;
