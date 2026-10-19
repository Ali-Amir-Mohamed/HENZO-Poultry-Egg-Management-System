-- =====================================================================
-- HENZO – Rapport mensuel des associés
--   * Pour un mois donné et chaque société de l'associé : ventes (et le
--     mois d'avant), charges, résultat, argent en fin de mois, à recevoir
--     et à payer en fin de mois, meilleurs clients et produits ; pour une
--     ferme, la production (poulets vendus, œufs ramassés, mortalité).
--   * Le 1er de chaque mois, Ali, Kenfack et Dahirou sont prévenus que le
--     rapport du mois écoulé est prêt (si les tâches programmées pg_cron
--     sont disponibles ; sinon le rapport s'ouvre quand on veut).
-- À exécuter dans Supabase > SQL Editor, après 0058 (peut être relancée sans erreur).
-- =====================================================================

create or replace function public.rapport_mois(p_mois date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c record;
  v_out jsonb := '[]'::jsonb;
  v_sites uuid[];
  v_debut date := date_trunc('month', coalesce(p_mois, current_date))::date;
  v_fin date := (date_trunc('month', coalesce(p_mois, current_date)) + interval '1 month - 1 day')::date;
  v_debut_prec date := (date_trunc('month', coalesce(p_mois, current_date)) - interval '1 month')::date;
  v_type text;
  v_ventes numeric; v_prec numeric; v_charges numeric; v_cout numeric := 0; v_comm numeric := 0; v_resultat numeric;
begin
  if not exists (select 1 from public.membres_fermes where user_id = auth.uid() and role::text in ('directeur', 'exploitation', 'finance')) then
    raise exception 'Réservé aux associés';
  end if;
  for c in
    select distinct public.societe_de(m.ferme_id) as id from public.membres_fermes m
    where m.user_id = auth.uid() and m.role::text in ('directeur', 'exploitation', 'finance')
  loop
    select array_agg(s) into v_sites from public.sites_de(c.id) s;
    select type_activite into v_type from public.fermes where id = c.id;
    select coalesce(sum(montant), 0) into v_ventes from public.ventes where ferme_id = any (v_sites) and not annulee and date_vente between v_debut and v_fin;
    select coalesce(sum(montant), 0) into v_prec from public.ventes where ferme_id = any (v_sites) and not annulee and date_vente >= v_debut_prec and date_vente < v_debut;
    select coalesce(sum(montant), 0) into v_charges from public.depenses
    where ferme_id = any (v_sites) and statut = 'validee' and not annulee and categorie <> 'retrait_associe' and date_depense between v_debut and v_fin
      and (v_type = 'elevage' or article_id is null);
    if v_type = 'negoce' then
      select coalesce(sum(v.quantite * coalesce(k.cout_unitaire_moyen, 0)), 0) into v_cout
      from public.ventes v left join public.cout_moyen_articles k on k.article_id = v.article_id
      where v.ferme_id = any (v_sites) and v.produit = 'marchandise' and not v.annulee and v.date_vente between v_debut and v_fin;
      select coalesce(sum(commission_montant), 0) into v_comm from public.commandes_eleveurs
      where ferme_id = any (v_sites) and statut = 'livree' and livree_le::date between v_debut and v_fin;
      v_resultat := v_ventes - round(v_cout) + v_comm - v_charges;
    else
      v_cout := 0; v_comm := 0;
      v_resultat := v_ventes - v_charges;
    end if;

    v_out := v_out || jsonb_build_object(
      'id', c.id, 'type', v_type,
      'nom', (select coalesce(nullif(raison_sociale, ''), nom) from public.fermes where id = c.id),
      'sites', (select jsonb_agg(nom order by created_at) from public.fermes where id = any (v_sites)),
      'ventes', v_ventes, 'ventes_prec', v_prec, 'cout', round(v_cout), 'commissions', v_comm, 'charges', v_charges, 'resultat', v_resultat,
      -- money at the end of the month (cash boxes), what was owed then
      'argent_fin', (select coalesce(sum(case e.sens when 'entree' then e.montant else -e.montant end), 0)
                     from public.ecritures e join public.caisses k on k.id = e.caisse_id where k.ferme_id = any (v_sites) and e.date_operation <= v_fin),
      'a_recevoir_fin', (select coalesce(sum(greatest(v.montant - v.montant_encaisse - v.avance_imputee
                            - coalesce((select sum(p.montant) from public.paiements_clients p where p.vente_id = v.id and p.date_paiement <= v_fin), 0), 0)), 0)
                         from public.ventes v where v.ferme_id = any (v_sites) and v.a_credit and not v.annulee and v.date_vente <= v_fin),
      'a_payer_fin', (select coalesce(sum(greatest(d.montant - d.montant_paye
                         - coalesce((select sum(p.montant) from public.paiements_fournisseurs p where p.depense_id = d.id and p.date_paiement <= v_fin), 0), 0)), 0)
                      from public.depenses d where d.ferme_id = any (v_sites) and d.a_credit and not d.annulee and d.statut = 'validee' and d.date_depense <= v_fin),
      'charges_detail', (select coalesce(jsonb_agg(jsonb_build_object('categorie', categorie, 'montant', m) order by m desc), '[]'::jsonb) from (
                           select categorie, sum(montant) as m from public.depenses
                           where ferme_id = any (v_sites) and statut = 'validee' and not annulee and categorie <> 'retrait_associe' and date_depense between v_debut and v_fin
                             and (v_type = 'elevage' or article_id is null)
                           group by categorie) x),
      'top_clients', (select coalesce(jsonb_agg(jsonb_build_object('nom', nom, 'montant', m) order by m desc), '[]'::jsonb) from (
                        select t.nom, sum(v.montant) as m from public.ventes v join public.tiers t on t.id = v.client_id
                        where v.ferme_id = any (v_sites) and not v.annulee and v.date_vente between v_debut and v_fin
                        group by t.nom order by sum(v.montant) desc limit 5) x),
      'top_produits', (select coalesce(jsonb_agg(jsonb_build_object('nom', nom, 'montant', m) order by m desc), '[]'::jsonb) from (
                         select coalesce(a.nom, v.produit) as nom, sum(v.montant) as m from public.ventes v left join public.articles a on a.id = v.article_id
                         where v.ferme_id = any (v_sites) and not v.annulee and v.date_vente between v_debut and v_fin
                         group by coalesce(a.nom, v.produit) order by sum(v.montant) desc limit 5) x),
      'nouveaux_clients', (select count(*) from public.tiers where ferme_id = any (v_sites) and type_tiers <> 'fournisseur' and created_at::date between v_debut and v_fin),
      'poulets_vendus', (select coalesce(sum(nombre_sujets), 0) from public.ventes where ferme_id = any (v_sites) and not annulee and produit = 'poulets' and date_vente between v_debut and v_fin),
      'oeufs', (select coalesce(sum(oeufs_collectes), 0) from public.pontes where ferme_id = any (v_sites) and date_ponte between v_debut and v_fin),
      'mortalite', (select coalesce(sum(nombre), 0) from public.mortalites where ferme_id = any (v_sites) and date_constat between v_debut and v_fin),
      'bandes_cloturees', (select count(*) from public.bandes where ferme_id = any (v_sites) and statut = 'cloturee' and date_cloture between v_debut and v_fin)
    );
  end loop;
  return jsonb_build_object('debut', v_debut, 'fin', v_fin, 'societes', v_out);
end;
$$;

-- The 1st of each month: the partners are told the report of the month just ended is ready
create or replace function public.rappel_rapport_mensuel()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mois text := to_char(date_trunc('month', current_date) - interval '1 month', 'MM/YYYY');
begin
  perform public.notifier(f.id, r, 'rapport_mensuel', format('Le rapport du mois %s est prêt : ventes, résultat, argent, dettes.', v_mois), '/rapport')
  from public.fermes f cross join unnest(array['directeur', 'exploitation', 'finance']::public.role_utilisateur[]) r
  where f.societe_id is null
    and not exists (select 1 from public.notifications n where n.ferme_id = f.id and n.type_notification = 'rapport_mensuel' and n.created_at::date = current_date);
end;
$$;

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('henzo-rapport-mensuel', '0 7 1 * *', 'select public.rappel_rapport_mensuel()');
  end if;
exception when others then
  raise notice 'Rappel du rapport mensuel non programmé (%). Le rapport reste disponible dans HENZO.', sqlerrm;
end;
$do$;

revoke execute on function public.rapport_mois(date) from public, anon;
grant execute on function public.rapport_mois(date) to authenticated;
revoke execute on function public.rappel_rapport_mensuel() from public, anon, authenticated;
