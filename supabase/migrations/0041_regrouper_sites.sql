-- =====================================================================
-- HENZO – Regrouper les sites d'une société
--   * Rattacher une ferme créée à part comme site d'une société (même
--     fiche, mêmes factures, même paie, même plan comptable, impôts et
--     comptabilité communs). Directeur des deux ; seulement pour une ferme
--     d'élevage qui n'a pas encore de facture à elle.
--   * Caisses de tous les sites de la société (direction, finance).
-- À exécuter une fois dans Supabase > SQL Editor, après 0040.
-- =====================================================================

create function public.rattacher_site(p_ferme uuid, p_societe uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.fermes;
  s uuid := public.societe_de(p_societe);
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur rattache un site'; end if;
  if not exists (select 1 from public.membres_fermes where user_id = auth.uid() and ferme_id = p_ferme and role = 'directeur')
     or not exists (select 1 from public.membres_fermes where user_id = auth.uid() and ferme_id = s and role = 'directeur') then
    raise exception 'Vous devez être directeur de la ferme et de la société';
  end if;
  select * into f from public.fermes where id = p_ferme for update;
  if f.id is null or s is null then raise exception 'Ferme ou société introuvable'; end if;
  if f.id = s then raise exception 'Choisissez une autre société'; end if;
  if f.type_activite <> 'elevage' or (select type_activite from public.fermes where id = s) <> 'elevage' then
    raise exception 'Seule une ferme d''élevage se rattache à une société d''élevage';
  end if;
  if f.societe_id is not null then raise exception 'Cette ferme est déjà un site'; end if;
  if exists (select 1 from public.fermes where societe_id = f.id) then raise exception 'Cette ferme a déjà ses propres sites'; end if;
  if exists (select 1 from public.factures where ferme_id = f.id) then
    raise exception 'Cette ferme a déjà ses propres factures : demandez à votre comptable avant de la rattacher';
  end if;
  update public.fermes set societe_id = s where id = f.id;
  -- même plan comptable que la société
  update public.plan_comptable n set numero = x.numero, intitule = x.intitule
  from public.plan_comptable x where x.ferme_id = s and x.cle = n.cle and n.ferme_id = f.id;
end;
$$;

create function public.caisses_societe()
returns table (site_id uuid, site text, activite public.activite, mode public.mode_paiement, solde numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Réservé à la direction et à la finance'; end if;
  return query
  select f.id, f.nom, c.activite, c.mode,
         coalesce((select sum(case e.sens when 'entree' then e.montant else -e.montant end) from public.ecritures e where e.caisse_id = c.id), 0)::numeric
  from public.caisses c join public.fermes f on f.id = c.ferme_id
  where c.ferme_id in (select public.sites_de(public.ferme_actuelle()))
  order by f.created_at, c.activite, c.mode;
end;
$$;

revoke execute on function public.rattacher_site(uuid, uuid), public.caisses_societe() from public, anon;
grant execute on function public.rattacher_site(uuid, uuid), public.caisses_societe() to authenticated;
