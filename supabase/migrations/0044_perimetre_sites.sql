-- =====================================================================
-- HENZO – Comptabilité : choisir n'importe quel site de la société
--   La fiche société donne la liste des sites ; la balance (et donc le
--   résultat et le bilan) se calcule pour toute la société ou pour un
--   site précis, sans avoir à ouvrir ce site.
-- À exécuter une fois dans Supabase > SQL Editor, après 0043.
-- =====================================================================

create or replace function public.fiche_societe(p_ferme uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cible uuid := coalesce(p_ferme, public.ferme_actuelle());
  f public.fermes;
begin
  if public.ferme_actuelle() is null or public.societe_de(v_cible) is distinct from public.societe_de(public.ferme_actuelle()) then
    raise exception 'Société introuvable';
  end if;
  select * into f from public.fermes where id = public.societe_de(v_cible);
  return jsonb_build_object(
    'id', f.id, 'nom', f.nom, 'raison_sociale', f.raison_sociale, 'forme_juridique', f.forme_juridique, 'capital_social', f.capital_social,
    'niu', f.niu, 'rccm', f.rccm, 'adresse_siege', f.adresse_siege, 'telephone_societe', f.telephone_societe, 'email_societe', f.email_societe,
    'banque_paiement', f.banque_paiement, 'mentions_facture', f.mentions_facture, 'numero_cnps_employeur', f.numero_cnps_employeur,
    'prefixe_facture', f.prefixe_facture, 'regime_fiscal', f.regime_fiscal, 'adherent_cga', f.adherent_cga, 'assujetti_tva', f.assujetti_tva,
    'taux_tva', f.taux_tva, 'taux_acompte', f.taux_acompte, 'taux_is', f.taux_is,
    'site', (select nom from public.fermes where id = v_cible), 'nombre_sites', (select count(*) from public.sites_de(v_cible)),
    'sites', (select jsonb_agg(jsonb_build_object('id', x.id, 'nom', x.nom) order by x.created_at) from public.fermes x where x.id in (select public.sites_de(v_cible))));
end;
$$;

drop function if exists public.soldes_comptables(date, date, boolean);
create function public.soldes_comptables(p_debut date, p_fin date, p_toute_societe boolean default false, p_site uuid default null)
returns table (compte text, intitule text, cle text, debit_periode numeric, credit_periode numeric, debit_cumule numeric, credit_cumule numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance', 'comptable') then raise exception 'Réservé à la direction et à la finance'; end if;
  if p_site is not null and p_site not in (select public.sites_de(public.ferme_actuelle())) then raise exception 'Site introuvable'; end if;
  return query
  select j.compte, min(j.intitule), min(j.cle),
         coalesce(sum(j.debit) filter (where j.date_ecriture >= p_debut), 0)::numeric,
         coalesce(sum(j.credit) filter (where j.date_ecriture >= p_debut), 0)::numeric,
         coalesce(sum(j.debit), 0)::numeric, coalesce(sum(j.credit), 0)::numeric
  from public.journal_comptable j
  where j.date_ecriture <= p_fin
    and (case when p_site is not null then j.ferme_id = p_site
              when p_toute_societe then j.ferme_id in (select public.sites_de(public.ferme_actuelle()))
              else j.ferme_id = public.ferme_actuelle() end)
  group by j.compte
  order by j.compte;
end;
$$;

revoke execute on function public.soldes_comptables(date, date, boolean, uuid) from public, anon;
grant execute on function public.soldes_comptables(date, date, boolean, uuid) to authenticated;
