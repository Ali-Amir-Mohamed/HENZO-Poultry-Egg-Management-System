-- =====================================================================
-- HENZO – Phase E : reprise de l'existant et rapport mensuel
-- À exécuter une fois dans Supabase > SQL Editor, après 0005.
--
--   * capital déjà investi avant HENZO (« capital_initial ») : compte dans le
--     capital de l'investisseur sans mouvement de caisse (l'argent est déjà
--     dans les soldes initiaux) ;
--   * prêt existant : enregistré avec ce qui a déjà été remboursé, sans
--     entrée en caisse ;
--   * fonction rapport_mensuel(mois) : toutes les données du rapport mensuel,
--     avec les droits de l'utilisateur (responsables uniquement).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Capital initial des investisseurs
-- ---------------------------------------------------------------------
alter table public.operations_investisseurs drop constraint operations_investisseurs_type_operation_check;
alter table public.operations_investisseurs add constraint operations_investisseurs_type_operation_check
  check (type_operation in ('apport', 'reinvestissement', 'retrait_capital', 'capital_initial'));
alter table public.operations_investisseurs drop constraint operations_investisseurs_check;
alter table public.operations_investisseurs add constraint operations_investisseurs_check
  check (type_operation in ('reinvestissement', 'capital_initial') or (activite is not null and mode_paiement is not null));

drop policy operations_insert on public.operations_investisseurs;
create policy operations_insert on public.operations_investisseurs for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid()
              and type_operation in ('apport', 'retrait_capital', 'capital_initial') and public.a_role('directeur', 'finance'));

create or replace view public.situation_investisseurs with (security_invoker = true) as
select i.id as investisseur_id, i.ferme_id, i.nom, i.telephone, i.actif,
       coalesce((select sum(o.montant) from public.operations_investisseurs o
                 where o.investisseur_id = i.id and not o.annulee and o.type_operation in ('apport', 'capital_initial')), 0) as capital_apporte,
       coalesce((select sum(o.montant) from public.operations_investisseurs o
                 where o.investisseur_id = i.id and not o.annulee and o.type_operation = 'reinvestissement'), 0) as capital_reinvesti,
       coalesce((select sum(o.montant) from public.operations_investisseurs o
                 where o.investisseur_id = i.id and not o.annulee and o.type_operation = 'retrait_capital'), 0) as capital_retire,
       coalesce((select sum(case o.type_operation when 'retrait_capital' then -o.montant else o.montant end)
                 from public.operations_investisseurs o where o.investisseur_id = i.id and not o.annulee), 0) as capital_restant,
       coalesce((select sum(d.montant) from public.distributions_investisseurs d
                 where d.investisseur_id = i.id and d.statut = 'retire'), 0) as dix_pourcent_verses,
       coalesce((select sum(d.montant) from public.distributions_investisseurs d
                 where d.investisseur_id = i.id and d.statut = 'en_attente'), 0) as dix_pourcent_en_attente
from public.investisseurs i;
-- (apres_operation_investisseur n'écrit en caisse que pour « apport » et « retrait_capital »)

-- ---------------------------------------------------------------------
-- 2. Prêts existants
-- ---------------------------------------------------------------------
alter table public.prets
  add column existant boolean not null default false,
  add column deja_rembourse numeric(16, 0) not null default 0 check (deja_rembourse >= 0),
  add constraint prets_deja_rembourse_max check (deja_rembourse <= montant_initial + interets);

create or replace function public.apres_pret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.existant then   -- un prêt existant est déjà dans les soldes initiaux
    perform public.ecrire_source(new.ferme_id, public.caisse_de(new.ferme_id, new.activite, new.mode_paiement), 'entree',
                                 new.montant_initial, 'pret_recu', 'Prêt de ' || new.preteur, new.date_pret, new.id);
  end if;
  return null;
end;
$$;

create or replace function public.solde_pret(p_pret uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select p.montant_initial + p.interets - p.deja_rembourse
         - coalesce((select sum(r.montant) from public.remboursements_prets r where r.pret_id = p.id and not r.annulee), 0)
  from public.prets p where p.id = p_pret
$$;

create or replace view public.situation_prets with (security_invoker = true) as
with remb as (
  select pret_id, sum(montant) as rembourse from public.remboursements_prets where not annulee group by pret_id
)
select p.id as pret_id, p.ferme_id, p.type_preteur, p.preteur, p.contact, p.date_pret, p.activite,
       p.montant_initial, p.interets, p.montant_initial + p.interets as montant_du,
       p.deja_rembourse + coalesce(r.rembourse, 0) as rembourse,
       p.montant_initial + p.interets - p.deja_rembourse - coalesce(r.rembourse, 0) as solde,
       (select min(e.date_echeance) from public.echeances_prets e
        where e.pret_id = p.id
          and (select sum(e2.montant) from public.echeances_prets e2
               where e2.pret_id = p.id and e2.date_echeance <= e.date_echeance) > p.deja_rembourse + coalesce(r.rembourse, 0)) as prochaine_echeance,
       coalesce((select sum(e.montant) from public.echeances_prets e
                 where e.pret_id = p.id and e.date_echeance < current_date), 0) > p.deja_rembourse + coalesce(r.rembourse, 0) as en_retard
from public.prets p
left join remb r on r.pret_id = p.id
where not p.annulee;

-- ---------------------------------------------------------------------
-- 3. Rapport mensuel
--   Ventes et dépenses du mois (dépenses validées ; achats stockés comptés à
--   l'achat ; retraits d'associés à part) ; trésorerie et stocks en fin de mois ;
--   créances, dettes, investisseurs, prêts à la date du jour ;
--   bandes clôturées dans le mois (bilans figés) et bandes / lots en cours.
-- ---------------------------------------------------------------------
create function public.rapport_mensuel(p_mois date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  d1 date := date_trunc('month', p_mois)::date;
  d2 date := (date_trunc('month', p_mois) + interval '1 month')::date;   -- exclu
  f  uuid := public.ferme_actuelle();
begin
  if not public.a_role('directeur', 'exploitation', 'finance') then
    raise exception 'Rapport réservé aux responsables';
  end if;

  return jsonb_build_object(
    'periode', jsonb_build_object('debut', d1, 'fin', d2 - 1),
    'ferme', (select nom from public.fermes where id = f),

    'production', jsonb_build_object(
      'oeufs_collectes', (select coalesce(sum(oeufs_collectes), 0) from public.pontes where ferme_id = f and date_ponte >= d1 and date_ponte < d2),
      'oeufs_casses',    (select coalesce(sum(oeufs_casses), 0) from public.pontes where ferme_id = f and date_ponte >= d1 and date_ponte < d2),
      'poulets_vendus',  (select coalesce(sum(nombre_sujets), 0) from public.ventes where ferme_id = f and not annulee and produit = 'poulets' and date_vente >= d1 and date_vente < d2),
      'kg_vendus',       (select coalesce(sum(quantite), 0) from public.ventes where ferme_id = f and not annulee and produit = 'poulets' and unite = 'kg' and date_vente >= d1 and date_vente < d2),
      'plateaux_vendus', (select coalesce(sum(quantite), 0) from public.ventes where ferme_id = f and not annulee and produit = 'plateaux' and date_vente >= d1 and date_vente < d2),
      'aliment_consomme_kg', (select coalesce(sum(m.quantite * case a.unite when 'kg' then 1 else a.poids_unitaire_kg end), 0)
                              from public.mouvements_stock m join public.articles a on a.id = m.article_id
                              where m.ferme_id = f and m.type_mouvement = 'sortie' and a.categorie = 'aliment'
                                and m.date_mouvement >= d1 and m.date_mouvement < d2)
    ),

    'mortalite', jsonb_build_object(
      'chair',    (select coalesce(sum(nombre), 0) from public.mortalites where ferme_id = f and bande_id is not null and date_constat >= d1 and date_constat < d2),
      'pondeuse', (select coalesce(sum(nombre), 0) from public.mortalites where ferme_id = f and lot_id is not null and date_constat >= d1 and date_constat < d2)
    ),

    'ventes', coalesce((select jsonb_agg(x order by x.activite, x.montant desc) from (
      select case when bande_id is not null then 'chair' else 'pondeuse' end as activite, produit, unite,
             sum(quantite) as quantite, sum(montant) as montant, count(*) filter (where a_credit) as a_credit
      from public.ventes where ferme_id = f and not annulee and date_vente >= d1 and date_vente < d2
      group by 1, 2, 3) x), '[]'::jsonb),

    'depenses', coalesce((select jsonb_agg(x order by x.activite, x.montant desc) from (
      select activite, categorie, sum(montant) as montant, count(*) as nombre
      from public.depenses where ferme_id = f and not annulee and statut = 'validee' and date_depense >= d1 and date_depense < d2
      group by 1, 2) x), '[]'::jsonb),

    'resultat', (select jsonb_agg(x) from (
      select a.activite,
             (select coalesce(sum(v.montant), 0) from public.ventes v
              where v.ferme_id = f and not v.annulee and v.date_vente >= d1 and v.date_vente < d2
                and (case when v.bande_id is not null then 'chair' else 'pondeuse' end) = a.activite::text) as ventes,
             (select coalesce(sum(d.montant), 0) from public.depenses d
              where d.ferme_id = f and not d.annulee and d.statut = 'validee' and d.categorie <> 'retrait_associe'
                and d.activite = a.activite and d.date_depense >= d1 and d.date_depense < d2) as depenses,
             (select coalesce(sum(d.montant), 0) from public.depenses d
              where d.ferme_id = f and not d.annulee and d.statut = 'validee' and d.categorie = 'retrait_associe'
                and d.activite = a.activite and d.date_depense >= d1 and d.date_depense < d2) as retraits
      from unnest(enum_range(null::public.activite)) a(activite)) x),

    'tresorerie', (select jsonb_agg(x order by x.activite, x.mode) from (
      select c.activite, c.mode,
             coalesce(sum(case e.sens when 'entree' then e.montant else -e.montant end) filter (where e.date_operation < d2), 0) as solde_fin,
             coalesce(sum(e.montant) filter (where e.sens = 'entree' and e.date_operation >= d1 and e.date_operation < d2), 0) as entrees,
             coalesce(sum(e.montant) filter (where e.sens = 'sortie' and e.date_operation >= d1 and e.date_operation < d2), 0) as sorties
      from public.caisses c left join public.ecritures e on e.caisse_id = c.id
      where c.ferme_id = f group by c.id) x),

    'stocks', coalesce((select jsonb_agg(x order by x.nom) from (
      select a.nom, a.unite, a.seuil_minimum,
             coalesce(sum(case m.type_mouvement when 'sortie' then -m.quantite else m.quantite end) filter (where m.date_mouvement < d2), 0) as stock_fin,
             coalesce(sum(m.quantite) filter (where m.type_mouvement = 'sortie' and m.date_mouvement >= d1 and m.date_mouvement < d2), 0) as consomme
      from public.articles a left join public.mouvements_stock m on m.article_id = a.id
      where a.ferme_id = f and a.actif group by a.id) x), '[]'::jsonb),

    'creances', jsonb_build_object(
      'total', (select coalesce(sum(reste), 0) from public.creances_clients where ferme_id = f),
      'en_retard', (select coalesce(sum(reste), 0) from public.creances_clients where ferme_id = f and en_retard)),
    'dettes', jsonb_build_object(
      'total', (select coalesce(sum(reste), 0) from public.dettes_fournisseurs where ferme_id = f),
      'en_retard', (select coalesce(sum(reste), 0) from public.dettes_fournisseurs where ferme_id = f and en_retard)),

    'investisseurs', coalesce((select jsonb_agg(x order by x.nom) from (
      select s.nom, s.capital_restant,
             (select coalesce(sum(d.montant), 0) from public.distributions_investisseurs d
              where d.investisseur_id = s.investisseur_id and d.created_at >= d1 and d.created_at < d2) as dix_pourcent_mois
      from public.situation_investisseurs s where s.ferme_id = f) x), '[]'::jsonb),

    'prets', coalesce((select jsonb_agg(x order by x.preteur) from (
      select p.preteur, p.solde, p.en_retard,
             (select coalesce(sum(r.montant), 0) from public.remboursements_prets r
              where r.pret_id = p.pret_id and not r.annulee and r.date_remboursement >= d1 and r.date_remboursement < d2) as rembourse_mois
      from public.situation_prets p where p.ferme_id = f) x), '[]'::jsonb),

    'bandes_cloturees', coalesce((select jsonb_agg(x order by x.code) from (
      select code, nombre_initial, morts, taux_mortalite, poulets_vendus, poids_moyen_g, fcr, cout_total,
             chiffre_affaires, marge_brute, duree_jours, cout_par_poulet_vendu
      from public.bilans_bandes where ferme_id = f and date_cloture >= d1 and date_cloture < d2) x), '[]'::jsonb),

    'bandes_en_cours', coalesce((select jsonb_agg(x order by x.code) from (
      select code, age_jours, restants, taux_mortalite, poids_moyen_g, fcr, cout_total, chiffre_affaires
      from public.indicateurs_bandes where statut <> 'cloturee') x), '[]'::jsonb),

    'lots', coalesce((select jsonb_agg(x order by x.code) from (
      select code, effectif, taux_ponte_7j, taux_casse, chiffre_affaires, cout_total, marge_brute
      from public.indicateurs_lots where statut = 'en_production') x), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.rapport_mensuel(date) from public, anon;
grant execute on function public.rapport_mensuel(date) to authenticated;
