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
--            journal, bilans, demandes de correction, historique des connexions,
--            employés, avances et paies, capital placé par bande,
--            ventes, stock, caisse, envois et prix des boutiques,
--            factures, impôts payés et bulletins de paie (les paramètres de paie restent).
-- Conserve aussi : les boutiques et leurs vendeurs.
-- Conserve aussi : les téléphones abonnés aux notifications.
-- TRUNCATE ne déclenche pas les protections ligne par ligne (registre non
-- modifiable) : c'est volontaire, uniquement pour ce nettoyage.
-- =====================================================================

truncate table
  public.relances_clients,
  public.fabrications,
  public.formules_lignes,
  public.formules_aliment,
  public.commissions_recues,
  public.avances_commandes,
  public.commandes_eleveurs,
  public.achats_intersocietes,
  public.paiements_impots,
  public.bulletins_paie,
  public.facture_lignes,
  public.factures,
  public.demandes_correction,
  public.capital_bandes,
  public.mouvements_caisse_boutique,
  public.mouvements_stock_boutique,
  public.clotures_boutique,
  public.versements_boutique,
  public.ventes_boutique,
  public.envois_lignes,
  public.envois_boutique,
  public.prix_boutique,
  public.avances_salaire,
  public.paies,
  public.employes,
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
union all select 'comptes conservés', count(*) from public.profiles
union all select 'fermes : ' || string_agg(nom, ', '), count(*) from public.fermes;
