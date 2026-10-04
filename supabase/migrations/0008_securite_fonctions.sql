-- =====================================================================
-- HENZO – Sécurité : fonctions internes non appelables depuis l'appli
-- À exécuter une fois dans Supabase > SQL Editor, après 0007.
--
-- Corrige l'avertissement du Security Advisor « Signed-In Users / Public
-- Can Execute SECURITY DEFINER Function » : on retire le droit d'exécution
-- de toutes les fonctions du schéma public, puis on le rend uniquement à
-- celles que les règles de sécurité et les vues utilisent avec les droits
-- de l'utilisateur. Les déclencheurs (triggers) continuent de fonctionner :
-- ce droit n'est vérifié qu'à leur création.
-- =====================================================================

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
  end loop;
end;
$$;

-- Indispensables aux règles de sécurité (RLS), aux vues et au rapport mensuel
grant execute on function
  public.role_actuel(),
  public.ferme_actuelle(),
  public.a_role(text[]),
  public.oiseaux_restants(uuid, uuid),
  public.reste_a_payer_vente(uuid),
  public.reste_a_payer_depense(uuid),
  public.rapport_mensuel(date)
to authenticated;

-- a_role n'a pas besoin de droits élevés : elle appelle role_actuel
alter function public.a_role(text[]) security invoker;
-- Chemin de recherche fixé (avertissement « Function Search Path Mutable »)
alter function public.activite_vente(public.ventes) set search_path = '';

-- Les prochaines fonctions ne seront pas exécutables par défaut :
-- chaque migration accordera explicitement ce qui est nécessaire.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
