-- =====================================================================
-- HENZO – Alerte « stock bas » seulement si un seuil est fixé
-- À exécuter une fois dans Supabase > SQL Editor, après 0008.
--
-- Avant : un produit sans seuil (0) et sans stock déclenchait « stock bas ».
-- Maintenant : alerte si un seuil est fixé et que le stock l'atteint,
-- ou si le stock est négatif (consommation saisie sans achat).
-- =====================================================================
create or replace view public.alertes as
with f as (
  select id, seuil_mortalite_pct, alerte_autonomie_jours from public.fermes where id = public.ferme_actuelle()
),
mort_jour as (
  select m.bande_id, m.lot_id, m.date_constat, sum(m.nombre) as morts
  from public.mortalites m, f
  where m.ferme_id = f.id and m.date_constat >= current_date - 1
  group by m.bande_id, m.lot_id, m.date_constat
)
-- mortalité anormale (hier / aujourd'hui)
select 'mortalite'::text as type_alerte, 'danger'::text as niveau,
       jsonb_build_object('code', coalesce(b.code, l.code), 'morts', mj.morts,
         'pct', round(100.0 * mj.morts / nullif(public.oiseaux_restants(mj.bande_id, mj.lot_id) + mj.morts, 0), 1), 'date', mj.date_constat) as params,
       case when mj.bande_id is not null then '/ferme/bande/' || mj.bande_id else '/ferme/lot/' || mj.lot_id end as lien,
       mj.date_constat as date_ref
from mort_jour mj
cross join f
left join public.bandes b on b.id = mj.bande_id
left join public.lots_pondeuses l on l.id = mj.lot_id
where 100.0 * mj.morts / nullif(public.oiseaux_restants(mj.bande_id, mj.lot_id) + mj.morts, 0) > f.seuil_mortalite_pct

union all
-- stock sous le seuil
select 'stock_bas', 'danger', jsonb_build_object('nom', s.nom, 'stock', s.stock, 'unite', s.unite), '/stock', current_date
from public.stock_articles s
where s.actif and ((s.seuil_minimum > 0 and s.stock <= s.seuil_minimum) or s.stock < 0)

union all
-- risque de rupture (autonomie insuffisante)
select 'rupture', 'warn', jsonb_build_object('nom', s.nom, 'jours', s.autonomie_jours), '/stock', current_date
from public.stock_articles s cross join f
where s.actif and s.stock > s.seuil_minimum and s.stock > 0 and s.autonomie_jours is not null and s.autonomie_jours < f.alerte_autonomie_jours

union all
-- vaccinations / traitements dans les 2 jours ou en retard
select case when t.date_prevue < current_date then 'soin_en_retard' else 'soin_proche' end,
       case when t.date_prevue < current_date then 'danger' else 'warn' end,
       jsonb_build_object('titre', t.titre, 'code', coalesce(b.code, l.code), 'date', t.date_prevue),
       '/planning', t.date_prevue
from public.taches t cross join f
left join public.bandes b on b.id = t.bande_id
left join public.lots_pondeuses l on l.id = t.lot_id
where t.ferme_id = f.id and t.statut = 'a_faire' and t.type_tache in ('vaccination', 'traitement')
  and t.date_prevue <= current_date + 2

union all
-- autres tâches en retard
select 'tache_en_retard', 'warn', jsonb_build_object('titre', t.titre, 'date', t.date_prevue), '/planning', t.date_prevue
from public.taches t cross join f
where t.ferme_id = f.id and t.statut = 'a_faire' and t.type_tache not in ('vaccination', 'traitement')
  and t.date_prevue < current_date

union all
-- clients en retard de paiement
select 'client_retard', 'danger', jsonb_build_object('client', c.client, 'reste', c.reste, 'date', c.date_echeance), '/argent', c.date_echeance
from public.creances_clients c cross join f
where c.ferme_id = f.id and c.en_retard

union all
-- dettes fournisseurs échues ou dans les 7 jours
select case when d.en_retard then 'dette_retard' else 'dette_proche' end,
       case when d.en_retard then 'danger' else 'warn' end,
       jsonb_build_object('fournisseur', d.fournisseur, 'reste', d.reste, 'date', d.date_echeance), '/argent', d.date_echeance
from public.dettes_fournisseurs d cross join f
where d.ferme_id = f.id and d.date_echeance is not null and d.date_echeance <= current_date + 7

union all
-- prêts : retard ou échéance dans les 7 jours
select case when p.en_retard then 'pret_retard' else 'pret_proche' end,
       case when p.en_retard then 'danger' else 'warn' end,
       jsonb_build_object('preteur', p.preteur, 'solde', p.solde, 'date', p.prochaine_echeance), '/argent', p.prochaine_echeance
from public.situation_prets p cross join f
where p.ferme_id = f.id and (p.en_retard or p.prochaine_echeance <= current_date + 7)

union all
-- dépenses à valider
select 'depenses_a_valider', 'warn', jsonb_build_object('nombre', count(*)), '/argent', current_date
from public.depenses d cross join f
where d.ferme_id = f.id and d.statut = 'a_valider' and not d.annulee
having count(*) > 0

union all
-- 10 % des investisseurs en attente
select 'dix_pourcent', 'warn', jsonb_build_object('montant', sum(di.montant)), '/argent', current_date
from public.distributions_investisseurs di cross join f
where di.ferme_id = f.id and di.statut = 'en_attente'
having sum(di.montant) > 0;
