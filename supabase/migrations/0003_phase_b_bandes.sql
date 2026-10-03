-- =====================================================================
-- HENZO – Phase B : fiche de bande, bilan de fin de bande, pondeuses
-- À exécuter une fois dans Supabase > SQL Editor, après 0002.
--
-- Règles de calcul :
--   * coût d'un produit consommé = quantité × coût moyen d'achat du produit
--     (achats non annulés / non rejetés) ;
--   * charges directes d'une bande = consommation de stock (aliment,
--     médicaments…) + dépenses rattachées à la bande hors achats stockés
--     (poussins, transport…) — un achat stocké compte quand il est consommé ;
--   * poids vif total = kg vendus au kilo + poulets vendus à la pièce et
--     poulets restants × dernier poids moyen ;
--   * FCR = kg d'aliment consommé / kg de poids vif ;
--   * le bilan est figé au moment où la finance valide la clôture.
-- =====================================================================

-- Poids d'une unité de produit (ex. sac de 50 kg) : nécessaire au FCR
alter table public.articles
  add column poids_unitaire_kg numeric(10, 3) check (poids_unitaire_kg > 0);

-- ---------------------------------------------------------------------
-- 1. Coût moyen d'achat des produits
-- ---------------------------------------------------------------------
create view public.cout_moyen_articles as
select m.article_id,
       sum(m.quantite * m.cout_unitaire) / nullif(sum(m.quantite), 0) as cout_unitaire_moyen
from public.mouvements_stock m
left join public.depenses d on d.id = m.depense_id
where m.type_mouvement = 'entree' and m.cout_unitaire is not null
  and (d.id is null or (not d.annulee and d.statut <> 'rejetee'))
group by m.article_id;

-- Consommation de stock (quantités, kg d'aliment, coûts) par bande ou par lot
create view public.consommation_stock as
select m.bande_id, m.lot_id,
       sum(case when a.categorie = 'aliment'
                then m.quantite * case a.unite when 'kg' then 1 else a.poids_unitaire_kg end end) as aliment_kg,
       sum(case when a.categorie = 'aliment' then m.quantite * c.cout_unitaire_moyen end)  as cout_aliment,
       sum(case when a.categorie <> 'aliment' then m.quantite * c.cout_unitaire_moyen end) as cout_autres_produits
from public.mouvements_stock m
join public.articles a on a.id = m.article_id
left join public.cout_moyen_articles c on c.article_id = m.article_id
where m.type_mouvement = 'sortie'
group by m.bande_id, m.lot_id;

-- Dépenses directes d'une bande / d'un lot (hors achats stockés)
create view public.charges_directes as
select bande_id, lot_id, sum(montant) as montant
from public.depenses
where (bande_id is not null or lot_id is not null)
  and article_id is null and not annulee and statut <> 'rejetee'
group by bande_id, lot_id;

-- ---------------------------------------------------------------------
-- 2. Indicateurs des bandes de poulets de chair
-- ---------------------------------------------------------------------
create view public.indicateurs_bandes_base as
with morts as (
  select bande_id, sum(nombre) as morts from public.mortalites where bande_id is not null group by bande_id
),
ventes as (
  select bande_id,
         sum(montant) as chiffre_affaires,
         sum(nombre_sujets) filter (where produit = 'poulets') as poulets_vendus,
         sum(montant) filter (where produit = 'poulets') as ca_poulets,
         sum(quantite) filter (where produit = 'poulets' and unite = 'kg') as kg_vendus_au_kilo,
         sum(nombre_sujets) filter (where produit = 'poulets' and unite = 'kg') as poulets_vendus_au_kilo
  from public.ventes where bande_id is not null and not annulee group by bande_id
),
pesee as (
  select distinct on (bande_id) bande_id, poids_moyen_g, date_pesee
  from public.pesees order by bande_id, date_pesee desc, created_at desc
),
calc as (
  select b.id as bande_id, b.ferme_id, b.code, b.statut, b.date_arrivee, b.date_cloture, b.nombre_initial,
         coalesce(b.date_cloture, current_date) - b.date_arrivee as duree_jours,
         (coalesce(b.date_cloture, current_date) - b.date_arrivee) + b.age_arrivee_jours as age_jours,
         coalesce(mo.morts, 0)::integer as morts,
         coalesce(v.poulets_vendus, 0)::integer as poulets_vendus,
         (b.nombre_initial - coalesce(mo.morts, 0) - coalesce(v.poulets_vendus, 0))::integer as restants,
         p.poids_moyen_g, p.date_pesee as derniere_pesee,
         case when p.poids_moyen_g is not null
              then round((p.poids_moyen_g - 42) / nullif((p.date_pesee - b.date_arrivee) + b.age_arrivee_jours, 0), 1)
         end as gmq_g_jour,
         coalesce(c.aliment_kg, 0) as aliment_kg,
         round(coalesce(c.cout_aliment, 0)) as cout_aliment,
         round(coalesce(c.cout_autres_produits, 0)) as cout_produits_sante,
         round(coalesce(d.montant, 0)) as autres_charges_directes,
         coalesce(v.chiffre_affaires, 0) as chiffre_affaires,
         coalesce(v.ca_poulets, 0) as ca_poulets,
         coalesce(v.kg_vendus_au_kilo, 0)
           + (coalesce(v.poulets_vendus, 0) - coalesce(v.poulets_vendus_au_kilo, 0)
              + (b.nombre_initial - coalesce(mo.morts, 0) - coalesce(v.poulets_vendus, 0)))
             * coalesce(p.poids_moyen_g, 0) / 1000.0 as poids_vif_kg
  from public.bandes b
  left join morts mo on mo.bande_id = b.id
  left join ventes v on v.bande_id = b.id
  left join pesee p on p.bande_id = b.id
  left join public.consommation_stock c on c.bande_id = b.id
  left join public.charges_directes d on d.bande_id = b.id
)
select calc.*,
       round(100.0 * morts / nombre_initial, 2) as taux_mortalite,
       cout_aliment + cout_produits_sante + autres_charges_directes as cout_total,
       chiffre_affaires - (cout_aliment + cout_produits_sante + autres_charges_directes) as marge_brute,
       round((cout_aliment + cout_produits_sante + autres_charges_directes) / nullif(poulets_vendus, 0)) as cout_par_poulet_vendu,
       round((cout_aliment + cout_produits_sante + autres_charges_directes) / nullif(poids_vif_kg, 0)) as cout_par_kg,
       round(ca_poulets / nullif(poulets_vendus, 0)) as prix_moyen_poulet,
       round(aliment_kg / nullif(poids_vif_kg, 0), 2) as fcr
from calc;

-- Vue de l'appli : ferme de l'utilisateur, rôles directeur / exploitation / finance
create view public.indicateurs_bandes as
select * from public.indicateurs_bandes_base
where ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance');

-- ---------------------------------------------------------------------
-- 3. Bilan figé à la clôture
-- ---------------------------------------------------------------------
create table public.bilans_bandes as
select * from public.indicateurs_bandes_base with no data;
alter table public.bilans_bandes
  add primary key (bande_id),
  add column fige_le timestamptz not null default now(),
  add column valide_par uuid references public.profiles (id);

create function public.figer_bilan_bande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bilans_bandes;
begin
  insert into public.bilans_bandes
  select base.*, now(), new.cloture_validee_par
  from public.indicateurs_bandes_base base where base.bande_id = new.id
  returning * into b;
  perform public.notifier(new.ferme_id, 'directeur', 'bilan_bande',
    format('Bilan de la bande %s : chiffre d''affaires %s FCFA, coût %s FCFA, marge %s FCFA, FCR %s',
           new.code, b.chiffre_affaires, b.cout_total, b.marge_brute, coalesce(b.fcr::text, '—')),
    '/ferme/bande/' || new.id);
  return null;
end;
$$;
create trigger figer_bilan after update of statut on public.bandes
  for each row when (new.statut = 'cloturee' and old.statut <> 'cloturee')
  execute function public.figer_bilan_bande();

create trigger immuable before update or delete on public.bilans_bandes
  for each row execute function public.registre_immuable();

alter table public.bilans_bandes enable row level security;
create policy bilans_select on public.bilans_bandes for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));

-- ---------------------------------------------------------------------
-- 4. Indicateurs des lots de pondeuses
-- ---------------------------------------------------------------------
create view public.indicateurs_lots_base as
with morts as (
  select lot_id, sum(nombre) as morts from public.mortalites where lot_id is not null group by lot_id
),
vendus as (
  select lot_id, sum(nombre_sujets) as vendus, sum(montant) as chiffre_affaires,
         sum(montant) filter (where produit in ('oeufs', 'plateaux')) as ca_oeufs
  from public.ventes where lot_id is not null and not annulee group by lot_id
),
ponte as (
  select lot_id,
         sum(oeufs_collectes) as oeufs_total,
         sum(oeufs_casses) as casses_total,
         sum(oeufs_collectes) filter (where date_ponte > current_date - 7) as oeufs_7j,
         count(distinct date_ponte) filter (where date_ponte > current_date - 7) as jours_7j
  from public.pontes group by lot_id
),
calc as (
  select l.id as lot_id, l.ferme_id, l.code, l.statut, l.date_arrivee, l.effectif_initial,
         ((coalesce(l.date_reforme, current_date) - l.date_arrivee) / 7) + l.age_arrivee_semaines as age_semaines,
         coalesce(mo.morts, 0)::integer as morts,
         (l.effectif_initial - coalesce(mo.morts, 0) - coalesce(v.vendus, 0))::integer as effectif,
         coalesce(p.oeufs_total, 0)::integer as oeufs_total,
         coalesce(p.casses_total, 0)::integer as casses_total,
         coalesce(p.oeufs_7j, 0)::integer as oeufs_7j,
         coalesce(p.jours_7j, 0)::integer as jours_saisis_7j,
         coalesce(c.aliment_kg, 0) as aliment_kg,
         round(coalesce(c.cout_aliment, 0)) as cout_aliment,
         round(coalesce(c.cout_autres_produits, 0)) as cout_produits_sante,
         round(coalesce(d.montant, 0)) as autres_charges_directes,
         coalesce(v.chiffre_affaires, 0) as chiffre_affaires,
         coalesce(v.ca_oeufs, 0) as ca_oeufs
  from public.lots_pondeuses l
  left join morts mo on mo.lot_id = l.id
  left join vendus v on v.lot_id = l.id
  left join ponte p on p.lot_id = l.id
  left join public.consommation_stock c on c.lot_id = l.id
  left join public.charges_directes d on d.lot_id = l.id
)
select calc.*,
       round(100.0 * morts / effectif_initial, 2) as taux_mortalite,
       -- taux de ponte moyen sur les jours saisis des 7 derniers jours
       case when effectif > 0 and jours_saisis_7j > 0
            then round(100.0 * oeufs_7j / (effectif * jours_saisis_7j), 1) end as taux_ponte_7j,
       case when oeufs_total > 0 then round(100.0 * casses_total / oeufs_total, 1) end as taux_casse,
       cout_aliment + cout_produits_sante + autres_charges_directes as cout_total,
       chiffre_affaires - (cout_aliment + cout_produits_sante + autres_charges_directes) as marge_brute,
       round((cout_aliment + cout_produits_sante + autres_charges_directes) / nullif(oeufs_total - casses_total, 0), 1) as cout_par_oeuf
from calc;

create view public.indicateurs_lots as
select * from public.indicateurs_lots_base
where ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance');

-- ---------------------------------------------------------------------
-- 5. Résultat par activité (chair / pondeuses)
--   charges directes   : celles des bandes / lots ;
--   charges générales  : dépenses générales (hors retraits d'associés) et dépenses
--                        de la ferme non rattachées à une bande / un lot ;
--   retraits d'associés : présentés à part.
-- ---------------------------------------------------------------------
create view public.resultat_activites as
with ca as (
  select case when bande_id is not null then 'chair' else 'pondeuse' end::public.activite as activite, sum(montant) as montant
  from public.ventes where not annulee and ferme_id = public.ferme_actuelle() group by 1
),
directes as (
  select 'chair'::public.activite as activite, sum(cout_total) as montant
  from public.indicateurs_bandes_base where ferme_id = public.ferme_actuelle()
  union all
  select 'pondeuse', sum(cout_total) from public.indicateurs_lots_base where ferme_id = public.ferme_actuelle()
),
generales as (
  select activite,
         sum(montant) filter (where categorie <> 'retrait_associe') as montant,
         sum(montant) filter (where categorie = 'retrait_associe') as retraits
  from public.depenses
  where not annulee and statut = 'validee' and ferme_id = public.ferme_actuelle()
    and bande_id is null and lot_id is null and article_id is null
  group by activite
)
select a.activite,
       coalesce(ca.montant, 0) as chiffre_affaires,
       coalesce(di.montant, 0) as charges_directes,
       coalesce(ca.montant, 0) - coalesce(di.montant, 0) as marge_brute,
       coalesce(g.montant, 0) as charges_generales,
       coalesce(ca.montant, 0) - coalesce(di.montant, 0) - coalesce(g.montant, 0) as benefice_net,
       coalesce(g.retraits, 0) as retraits_associes
from unnest(enum_range(null::public.activite)) a(activite)
left join ca on ca.activite = a.activite
left join directes di on di.activite = a.activite
left join generales g on g.activite = a.activite
where public.a_role('directeur', 'exploitation', 'finance');

-- ---------------------------------------------------------------------
-- 6. Accès : les vues « _base » et intermédiaires restent internes
-- ---------------------------------------------------------------------
revoke all on public.cout_moyen_articles, public.consommation_stock, public.charges_directes,
              public.indicateurs_bandes_base, public.indicateurs_lots_base
  from anon, authenticated;
revoke all on public.indicateurs_bandes, public.indicateurs_lots, public.resultat_activites, public.bilans_bandes from anon;
