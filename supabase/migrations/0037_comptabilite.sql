-- =====================================================================
-- HENZO – Comptabilité (SYSCOHADA)
--   * Plan comptable par ferme : chaque usage (caisse, clients, achats
--     d'aliment, ventes de poulets…) pointe vers un numéro de compte,
--     modifiable par la direction et la finance (le comptable confirme).
--   * Journal en partie double, calculé à partir de ce que HENZO enregistre
--     déjà (rien à saisir en plus) :
--       VT ventes (clients / ventes de produits, TVA si facture avec TVA),
--       BO ventes des boutiques (caisse des boutiques),
--       AC achats et charges (charges / fournisseurs),
--       PA salaires (bulletins : brut, CNPS, impôts sur salaires, charges),
--       CA / BQ / MM mouvements des caisses espèces / banque / Mobile Money,
--       OD 10 % réinvestis par les investisseurs.
--     Une opération annulée sort du journal ; ses mouvements de caisse
--     annulés s'équilibrent entre eux.
--   * Soldes par compte sur une période (balance, compte de résultat,
--     bilan simplifié). Stocks, amortissements et impôt de fin d'année :
--     écritures du comptable.
-- À exécuter une fois dans Supabase > SQL Editor, après 0036.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Plan comptable
-- ---------------------------------------------------------------------
create table public.plan_comptable (
  ferme_id  uuid not null references public.fermes (id),
  cle       text not null,
  numero    text not null check (numero ~ '^[1-9][0-9]{1,9}$'),
  intitule  text not null check (trim(intitule) <> ''),
  primary key (ferme_id, cle)
);

create function public.plan_comptable_defaut()
returns table (cle text, numero text, intitule text)
language sql
immutable
set search_path = ''
as $$
  values
    ('caisse_especes_chair', '5711', 'Caisse espèces – chair'), ('caisse_especes_pondeuse', '5712', 'Caisse espèces – pondeuses'),
    ('caisse_banque_chair', '5211', 'Banque – chair'), ('caisse_banque_pondeuse', '5212', 'Banque – pondeuses'),
    ('caisse_mobile_money_chair', '5521', 'Mobile Money – chair'), ('caisse_mobile_money_pondeuse', '5522', 'Mobile Money – pondeuses'),
    ('caisse_boutiques', '5713', 'Caisses des boutiques'), ('virements_internes', '5851', 'Virements de fonds'),
    ('clients', '4111', 'Clients'), ('fournisseurs', '4011', 'Fournisseurs'),
    ('personnel', '4221', 'Personnel, rémunérations dues'), ('cnps', '4311', 'CNPS'),
    ('etat_impots_salaires', '4471', 'État, impôts retenus sur salaires'), ('etat_is', '4411', 'État, impôt sur les bénéfices'),
    ('etat_tva_due', '4441', 'État, TVA due'), ('tva_collectee', '4431', 'TVA facturée sur ventes'),
    ('associes', '4621', 'Associés, comptes courants'), ('investisseurs', '1681', 'Autres emprunts et dettes – investisseurs'),
    ('emprunts', '1621', 'Emprunts auprès des établissements de crédit'),
    ('achat_poussins', '6021', 'Achats de poussins'), ('achat_aliment', '6022', 'Achats d''aliment'),
    ('achat_medicaments', '6023', 'Achats de produits vétérinaires'), ('main_oeuvre_ext', '6371', 'Personnel extérieur'),
    ('transport', '6181', 'Transports'), ('entretien', '6241', 'Entretien et réparations'), ('loyers', '6222', 'Locations de bâtiments'),
    ('eau_electricite', '6051', 'Eau et électricité'), ('fonctionnement', '6388', 'Autres charges externes'),
    ('autres_charges', '6588', 'Autres charges diverses'), ('impots_taxes', '6418', 'Impôts et taxes'),
    ('salaires', '6611', 'Rémunérations du personnel'), ('charges_sociales', '6641', 'Charges sociales (CNPS employeur)'),
    ('taxes_salaires', '6413', 'Taxes sur salaires (CFC, FNE)'), ('remuneration_investisseurs', '6711', 'Rémunération des investisseurs (10 %)'),
    ('ecarts_negatifs', '6581', 'Écarts de caisse négatifs'), ('produits_divers', '7588', 'Produits divers (écarts, retenues)'),
    ('vente_poulets', '7021', 'Ventes de poulets'), ('vente_oeufs', '7022', 'Ventes d''œufs'),
    ('vente_reformees', '7023', 'Ventes de poules réformées'), ('vente_fientes', '7024', 'Ventes de fientes'),
    ('vente_autres', '7028', 'Autres ventes de produits')
$$;

insert into public.plan_comptable (ferme_id, cle, numero, intitule)
select f.id, d.cle, d.numero, d.intitule from public.fermes f cross join public.plan_comptable_defaut() d
on conflict do nothing;

create function public.plan_comptable_nouvelle_ferme()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.plan_comptable (ferme_id, cle, numero, intitule)
  select new.id, d.cle, d.numero, d.intitule from public.plan_comptable_defaut() d on conflict do nothing;
  return new;
end;
$$;
create trigger plan_comptable_nouvelle_ferme after insert on public.fermes
  for each row execute function public.plan_comptable_nouvelle_ferme();

create function public.maj_compte(p_cle text, p_numero text, p_intitule text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls la direction et la finance modifient le plan comptable'; end if;
  if trim(coalesce(p_numero, '')) !~ '^[1-9][0-9]{1,9}$' then raise exception 'Numéro de compte invalide (chiffres seulement, ex. 6022)'; end if;
  update public.plan_comptable set numero = trim(p_numero), intitule = coalesce(nullif(trim(p_intitule), ''), intitule)
  where ferme_id = public.ferme_actuelle() and cle = p_cle;
  if not found then raise exception 'Compte inconnu'; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Journal
-- ---------------------------------------------------------------------
create view public.journal_comptable_brut with (security_invoker = true) as
with
-- Comptes des caisses
cx as (select id, ferme_id, 'caisse_' || mode || '_' || activite as cle,
              case mode when 'especes' then 'CA' when 'banque' then 'BQ' else 'MM' end as journal
       from public.caisses),
-- Usage d'un impôt payé
imp as (select depense_id, type_impot from public.paiements_impots),
-- Dépenses de salaires liées à une paie ou à une avance
sal as (select depense_id from public.paies where depense_id is not null
        union select depense_id from public.avances_salaire where depense_id is not null),
-- Compte de contrepartie de chaque mouvement de caisse (une annulation reprend celui de l'opération d'origine ;
-- une correction manuelle du directeur est un écart de caisse)
ec as (
  select e.*, coalesce(o.nature, e.nature) as nature_origine, coalesce(o.libelle, e.libelle) as libelle_origine,
         coalesce(e.depense_id, o.depense_id) as dep_id
  from public.ecritures e
  left join public.ecritures o on o.id = e.ecriture_corrigee_id and e.nature = 'annulation'
),
ec2 as (
  select ec.*, cx.cle as cle_caisse, cx.journal,
    case ec.nature_origine
      when 'vente' then 'clients'
      when 'encaissement_creance' then 'clients'
      when 'paiement_fournisseur' then 'fournisseurs'
      when 'depense' then
        case
          when d.categorie = 'salaires' then 'personnel'
          when d.categorie = 'retrait_associe' then 'associes'
          when d.categorie = 'cotisations_sociales' then 'cnps'
          when d.categorie = 'impots_taxes' and imp.type_impot = 'impots_salaires' then 'etat_impots_salaires'
          when d.categorie = 'impots_taxes' and imp.type_impot in ('acompte_is', 'solde_is') then 'etat_is'
          when d.categorie = 'impots_taxes' and imp.type_impot = 'tva' then 'etat_tva_due'
          else 'fournisseurs'
        end
      when 'solde_initial' then
        case when ec.libelle_origine like 'Démarrage : investissement%' then 'investisseurs'
             when ec.libelle_origine like 'Démarrage : prêt%' then 'emprunts'
             else 'associes' end
      when 'apport_investisseur' then 'investisseurs'
      when 'retrait_investisseur' then 'investisseurs'
      when 'versement_investisseur' then 'remuneration_investisseurs'
      when 'pret_recu' then 'emprunts'
      when 'remboursement_pret' then 'emprunts'
      when 'transfert' then 'virements_internes'
      when 'versement_boutique' then 'caisse_boutiques'
      when 'ajustement_caisse' then case when ec.sens = 'entree' then 'produits_divers' else 'ecarts_negatifs' end
      when 'correction' then case when ec.sens = 'entree' then 'produits_divers' else 'ecarts_negatifs' end
      else 'autres_charges'
    end as cle_contrepartie
  from ec
  join cx on cx.id = ec.caisse_id
  left join public.depenses d on d.id = ec.dep_id
  left join imp on imp.depense_id = ec.dep_id
),
mouvements as (
  select ferme_id, date_operation as date_ecriture, journal, 'E-' || left(id::text, 8) as piece, coalesce(libelle, libelle_origine) as libelle,
         cle_caisse as cle, case when sens = 'entree' then montant else 0 end as debit, case when sens = 'sortie' then montant else 0 end as credit,
         'ecriture' as source, id as source_id
  from ec2
  union all
  select ferme_id, date_operation, journal, 'E-' || left(id::text, 8), coalesce(libelle, libelle_origine),
         cle_contrepartie, case when sens = 'sortie' then montant else 0 end, case when sens = 'entree' then montant else 0 end,
         'ecriture', id
  from ec2
),
-- Ventes : clients (ou caisse des boutiques) / ventes de produits (+ TVA si facture avec TVA)
vt as (
  select v.*, case v.produit when 'poulets' then 'vente_poulets' when 'oeufs' then 'vente_oeufs' when 'plateaux' then 'vente_oeufs'
                             when 'poules_reformees' then 'vente_reformees' when 'fientes' then 'vente_fientes' else 'vente_autres' end as cle_produit,
         case when fa.tva_applicable then round(v.montant / (1 + fa.taux_tva / 100)) else v.montant end as ht
  from public.ventes v
  left join public.facture_lignes fl on fl.vente_id = v.id and fl.active
  left join public.factures fa on fa.id = fl.facture_id and not fa.annulee
  where not v.annulee
),
ventes as (
  select ferme_id, date_vente, case when boutique_id is null then 'VT' else 'BO' end, 'V-' || left(id::text, 8),
         'Vente ' || produit, case when boutique_id is null then 'clients' else 'caisse_boutiques' end, montant, 0::numeric, 'vente', id
  from vt
  union all
  select ferme_id, date_vente, case when boutique_id is null then 'VT' else 'BO' end, 'V-' || left(id::text, 8),
         'Vente ' || produit, cle_produit, 0, ht, 'vente', id
  from vt
  union all
  select ferme_id, date_vente, 'VT', 'V-' || left(id::text, 8), 'TVA sur vente ' || produit, 'tva_collectee', 0, montant - ht, 'vente', id
  from vt where montant - ht > 0
),
-- Achats et charges : charge / fournisseurs (les paiements sans charge – salaires payés, retraits, CNPS, impôts reversés – n'en ont pas)
ac as (
  select d.*, case d.categorie
           when 'poussins' then 'achat_poussins' when 'aliment' then 'achat_aliment' when 'medicament' then 'achat_medicaments'
           when 'main_oeuvre' then 'main_oeuvre_ext' when 'transport' then 'transport' when 'entretien' then 'entretien'
           when 'loyer' then 'loyers' when 'charges' then 'eau_electricite' when 'fonctionnement' then 'fonctionnement'
           when 'impots_taxes' then 'impots_taxes' when 'salaires' then 'salaires' else 'autres_charges' end as cle_charge,
         case when d.categorie = 'salaires' then 'personnel' else 'fournisseurs' end as cle_tiers
  from public.depenses d
  left join imp on imp.depense_id = d.id
  where d.statut = 'validee' and not d.annulee
    and d.categorie not in ('retrait_associe', 'cotisations_sociales')
    and not (d.categorie = 'impots_taxes' and coalesce(imp.type_impot, '') in ('impots_salaires', 'acompte_is', 'solde_is', 'tva'))
    and not (d.categorie = 'salaires' and d.id in (select depense_id from sal))
),
achats as (
  select ferme_id, date_depense, 'AC', 'D-' || left(id::text, 8), libelle, cle_charge, montant, 0::numeric, 'depense', id from ac
  union all
  select ferme_id, date_depense, 'AC', 'D-' || left(id::text, 8), libelle, cle_tiers, 0, montant, 'depense', id from ac
),
-- Salaires : brut / personnel ; retenues légales et charges de l'employeur / CNPS et État
pa as (
  select p.*, b.id as bulletin_id, b.cnps_salarie, b.irpp + b.cac + b.cfc_salarie + b.rav + b.tdl as impots_salarie,
         b.cnps_vieillesse_pat + b.cnps_allocations + b.cnps_accidents as cnps_patronal, b.cfc_patronal + b.fne as taxes_patronales,
         (select nom from public.employes where id = p.employe_id) as nom
  from public.paies p left join public.bulletins_paie b on b.paie_id = p.id
  where not p.annulee
),
paie as (
  select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Salaire ' || to_char(mois, 'MM/YYYY') || ' – ' || nom, 'salaires', salaire_base + primes, 0::numeric, 'paie', id from pa
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Salaire ' || to_char(mois, 'MM/YYYY') || ' – ' || nom, 'personnel', 0, salaire_base + primes, 'paie', id from pa
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Retenues légales – ' || nom, 'personnel', retenues_legales, 0, 'paie', id from pa where retenues_legales > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'CNPS salarié – ' || nom, 'cnps', 0, cnps_salarie, 'paie', id from pa where coalesce(cnps_salarie, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Impôts sur salaire – ' || nom, 'etat_impots_salaires', 0, impots_salarie, 'paie', id from pa where coalesce(impots_salarie, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Charges CNPS employeur – ' || nom, 'charges_sociales', cnps_patronal, 0, 'paie', id from pa where coalesce(cnps_patronal, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Charges CNPS employeur – ' || nom, 'cnps', 0, cnps_patronal, 'paie', id from pa where coalesce(cnps_patronal, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'CFC et FNE employeur – ' || nom, 'taxes_salaires', taxes_patronales, 0, 'paie', id from pa where coalesce(taxes_patronales, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'CFC et FNE employeur – ' || nom, 'etat_impots_salaires', 0, taxes_patronales, 'paie', id from pa where coalesce(taxes_patronales, 0) > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Retenue – ' || nom, 'personnel', retenues, 0, 'paie', id from pa where retenues > 0
  union all select ferme_id, created_at::date, 'PA', 'P-' || left(id::text, 8), 'Retenue – ' || nom, 'produits_divers', 0, retenues, 'paie', id from pa where retenues > 0
),
-- 10 % réinvestis : rémunération / dette envers l'investisseur
od as (
  select ferme_id, coalesce(decide_le, created_at)::date as d, 'OD' as j, 'R-' || left(id::text, 8) as piece,
         '10 % réinvestis' as lib, 'remuneration_investisseurs' as cle, montant as debit, 0::numeric as credit, 'distribution' as source, id
  from public.distributions_investisseurs where statut = 'reinvesti' and montant > 0
  union all
  select ferme_id, coalesce(decide_le, created_at)::date, 'OD', 'R-' || left(id::text, 8), '10 % réinvestis', 'investisseurs', 0, montant, 'distribution', id
  from public.distributions_investisseurs where statut = 'reinvesti' and montant > 0
)
select * from mouvements
union all select * from ventes
union all select * from achats
union all select * from paie
union all select * from od;

create view public.journal_comptable with (security_invoker = true) as
select j.ferme_id, j.date_ecriture, j.journal, j.piece, j.libelle, j.cle,
       coalesce(pc.numero, '0') as compte, coalesce(pc.intitule, j.cle) as intitule,
       j.debit::numeric(16, 0) as debit, j.credit::numeric(16, 0) as credit, j.source, j.source_id
from public.journal_comptable_brut j
left join public.plan_comptable pc on pc.ferme_id = j.ferme_id and pc.cle = j.cle
where (j.debit <> 0 or j.credit <> 0) and public.a_role('directeur', 'finance');

-- ---------------------------------------------------------------------
-- 3. Soldes par compte (balance, résultat, bilan)
--    période = mouvements entre p_debut et p_fin ; cumul = depuis le début jusqu'à p_fin
-- ---------------------------------------------------------------------
create function public.soldes_comptables(p_debut date, p_fin date)
returns table (compte text, intitule text, cle text, debit_periode numeric, credit_periode numeric, debit_cumule numeric, credit_cumule numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Réservé à la direction et à la finance'; end if;
  return query
  select j.compte, min(j.intitule), min(j.cle),
         coalesce(sum(j.debit) filter (where j.date_ecriture >= p_debut), 0)::numeric,
         coalesce(sum(j.credit) filter (where j.date_ecriture >= p_debut), 0)::numeric,
         coalesce(sum(j.debit), 0)::numeric, coalesce(sum(j.credit), 0)::numeric
  from public.journal_comptable j
  where j.ferme_id = public.ferme_actuelle() and j.date_ecriture <= p_fin
  group by j.compte
  order by j.compte;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Droits
-- ---------------------------------------------------------------------
alter table public.plan_comptable enable row level security;
create policy plan_comptable_select on public.plan_comptable for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));

revoke all on public.plan_comptable, public.journal_comptable_brut, public.journal_comptable from anon;
revoke insert, update, delete on public.plan_comptable from authenticated;
revoke execute on function public.plan_comptable_nouvelle_ferme() from public, anon, authenticated;
revoke execute on function public.maj_compte(text, text, text), public.soldes_comptables(date, date) from public, anon;
grant execute on function public.maj_compte(text, text, text), public.soldes_comptables(date, date) to authenticated;
