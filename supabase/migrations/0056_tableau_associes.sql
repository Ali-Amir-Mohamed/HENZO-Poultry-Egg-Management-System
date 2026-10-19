-- =====================================================================
-- HENZO – Tableau de bord des associés
--   * Une seule page pour Ali, Kenfack et Dahirou : les chiffres clés de
--     chaque société dont ils sont membres (la ferme avec tous ses sites,
--     HENZO AGRO), côte à côte, sans changer de société.
--   * Pour chaque société : argent disponible, ventes du mois et du mois
--     dernier, résultat du mois, à recevoir, à payer, et ce qui attend
--     (dépenses à valider, versements de boutique, livraisons du groupe,
--     stock bas, commandes de poussins de la semaine) ; pour une ferme,
--     les poulets et les pondeuses en élevage.
--   * Résultat du mois : ferme = ventes − dépenses du mois ; HENZO AGRO =
--     ventes − prix d'achat de ce qui est vendu + livraisons + commissions
--     − charges (comme la page Bénéfices). Les retraits des associés ne
--     comptent pas.
-- À exécuter une fois dans Supabase > SQL Editor, après 0055.
-- =====================================================================

create function public.tableau_associes()
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
  v_debut date := date_trunc('month', current_date)::date;
  v_debut_prec date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_ventes numeric; v_ventes_prec numeric; v_resultat numeric; v_cout numeric; v_charges numeric; v_extra numeric;
begin
  if not exists (select 1 from public.membres_fermes where user_id = auth.uid() and role::text in ('directeur', 'exploitation', 'finance')) then
    raise exception 'Réservé aux associés';
  end if;
  for c in
    select distinct public.societe_de(m.ferme_id) as id
    from public.membres_fermes m
    where m.user_id = auth.uid() and m.role::text in ('directeur', 'exploitation', 'finance')
  loop
    select array_agg(s) into v_sites from public.sites_de(c.id) s;
    select coalesce(sum(montant), 0) into v_ventes from public.ventes
    where ferme_id = any (v_sites) and not annulee and date_vente >= v_debut;
    select coalesce(sum(montant), 0) into v_ventes_prec from public.ventes
    where ferme_id = any (v_sites) and not annulee and date_vente >= v_debut_prec and date_vente < v_debut;
    select coalesce(sum(montant), 0) into v_charges from public.depenses
    where ferme_id = any (v_sites) and statut = 'validee' and not annulee and categorie <> 'retrait_associe' and date_depense >= v_debut
      and ((select type_activite from public.fermes where id = c.id) = 'elevage' or article_id is null);
    if (select type_activite from public.fermes where id = c.id) = 'negoce' then
      -- trading: purchase cost of the goods sold this month, plus commissions earned this month
      select coalesce(sum(v.quantite * coalesce(k.cout_unitaire_moyen, 0)), 0) into v_cout
      from public.ventes v left join public.cout_moyen_articles k on k.article_id = v.article_id
      where v.ferme_id = any (v_sites) and v.produit = 'marchandise' and not v.annulee and v.date_vente >= v_debut;
      select coalesce(sum(commission_montant), 0) into v_extra from public.commandes_eleveurs
      where ferme_id = any (v_sites) and statut = 'livree' and livree_le::date >= v_debut;
      v_resultat := v_ventes - round(v_cout) + v_extra - v_charges;
    else
      v_resultat := v_ventes - v_charges;
    end if;

    v_out := v_out || jsonb_build_object(
      'id', c.id,
      'nom', (select coalesce(nullif(raison_sociale, ''), nom) from public.fermes where id = c.id),
      'type', (select type_activite from public.fermes where id = c.id),
      'sites', (select jsonb_agg(nom order by created_at) from public.fermes where id = any (v_sites)),
      'caisse', (select coalesce(sum(case e.sens when 'entree' then e.montant else -e.montant end), 0)
                 from public.ecritures e join public.caisses k on k.id = e.caisse_id where k.ferme_id = any (v_sites)),
      'caisse_boutiques', (select coalesce(sum(case m.sens when 'entree' then m.montant else -m.montant end), 0)
                           from public.mouvements_caisse_boutique m join public.boutiques b on b.id = m.boutique_id where b.ferme_id = c.id),
      'ventes_mois', v_ventes,
      'ventes_mois_dernier', v_ventes_prec,
      'resultat_mois', v_resultat,
      'a_recevoir', (select coalesce(sum(public.reste_a_payer_vente(v.id)), 0) from public.ventes v
                     where v.ferme_id = any (v_sites) and v.a_credit and not v.annulee),
      'a_payer', (select coalesce(sum(public.reste_a_payer_depense(d.id)), 0) from public.depenses d
                  where d.ferme_id = any (v_sites) and d.a_credit and not d.annulee and d.statut = 'validee'),
      'groupe_a_recevoir', (select coalesce(sum(public.reste_a_payer_vente(v.id)), 0) from public.ventes v join public.tiers t on t.id = v.client_id
                            where v.ferme_id = any (v_sites) and v.a_credit and not v.annulee and t.ferme_liee_id is not null),
      'depenses_a_valider', (select count(*) from public.depenses where ferme_id = any (v_sites) and statut = 'a_valider' and not annulee),
      'versements_attente', (select count(*) from public.versements_boutique vb join public.boutiques b on b.id = vb.boutique_id
                             where b.ferme_id = c.id and vb.statut = 'en_attente'),
      'livraisons_attente', (select count(*) from public.achats_intersocietes where ferme_id = any (v_sites) and statut = 'en_attente'),
      'stock_bas', (select count(*) from public.articles a where a.ferme_id = any (v_sites) and a.actif and a.seuil_minimum > 0
                    and public.stock_article(a.id) <= a.seuil_minimum),
      'commandes_semaine', (select count(*) from public.commandes_eleveurs where ferme_id = any (v_sites) and statut = 'en_cours'
                            and date_livraison <= current_date + 7),
      'poulets', (select coalesce(sum(public.oiseaux_restants(b.id, null)), 0) from public.bandes b where b.ferme_id = any (v_sites) and b.statut <> 'cloturee'),
      'bandes', (select count(*) from public.bandes b where b.ferme_id = any (v_sites) and b.statut <> 'cloturee'),
      'pondeuses', (select coalesce(sum(public.oiseaux_restants(null, l.id)), 0) from public.lots_pondeuses l where l.ferme_id = any (v_sites) and l.statut = 'en_production')
    );
  end loop;
  return v_out;
end;
$$;

revoke execute on function public.tableau_associes() from public, anon;
grant execute on function public.tableau_associes() to authenticated;
