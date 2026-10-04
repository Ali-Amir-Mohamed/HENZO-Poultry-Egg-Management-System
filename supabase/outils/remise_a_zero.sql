-- =====================================================================
-- HENZO – Remise à zéro des données de la ferme (avant le vrai démarrage)
-- ⚠️ IRRÉVERSIBLE : efface toutes les données d'exploitation.
-- À lancer seulement après accord du directeur, dans Supabase > SQL Editor.
-- ⚠️ Efface les données de TOUTES les fermes (pas seulement la ferme active).
--
-- Conserve : comptes, rôles et fermes, paramètres, les 6 caisses par ferme
--            (qui repartent à 0), programme de vaccination (modèles).
-- Efface   : bandes, lots, saisies, ventes, dépenses, paiements, écritures,
--            stock et produits, clients / fournisseurs, prix, investisseurs,
--            prêts, vérifications, transferts, tâches, notifications,
--            journal, bilans.
-- TRUNCATE ne déclenche pas les protections ligne par ligne (registre non
-- modifiable) : c'est volontaire, uniquement pour ce nettoyage.
-- =====================================================================

truncate table
  public.taches_realisations,
  public.taches,
  public.verifications_caisse,
  public.transferts_caisses,
  public.remboursements_prets,
  public.echeances_prets,
  public.prets,
  public.distributions_investisseurs,
  public.operations_investisseurs,
  public.investisseurs,
  public.bilans_bandes,
  public.ecritures,
  public.paiements_clients,
  public.paiements_fournisseurs,
  public.mouvements_stock,
  public.ventes,
  public.depenses,
  public.observations,
  public.pesees,
  public.pontes,
  public.mortalites,
  public.livraisons_poussins,
  public.commandes_poussins,
  public.bandes,
  public.lots_pondeuses,
  public.batiments,
  public.prix_vente,
  public.articles,
  public.tiers,
  public.ajustements_oeufs,
  public.connexions,
  public.notifications,
  public.journal_activite
restart identity;

-- Vérification : tout doit être à 0, les caisses existent toujours
select 'caisses (6 par ferme)' as element, count(*) as nombre from public.caisses
union all select 'écritures', count(*) from public.ecritures
union all select 'bandes', count(*) from public.bandes
union all select 'ventes', count(*) from public.ventes
union all select 'comptes conservés', count(*) from public.profiles;
