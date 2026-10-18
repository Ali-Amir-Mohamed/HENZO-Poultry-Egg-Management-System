-- =====================================================================
-- HENZO AGRO – Commandes de poussins, avances, commissions
--   * Un éleveur commande des poussins pour une date de livraison
--     (souche, nombre, prix), chez un couvoir.
--   * Deux façons de travailler, choisies à chaque commande :
--       - revente : HENZO AGRO achète au couvoir et revend ; l'éleveur
--         verse des avances, déduites le jour de la livraison (le reste
--         est payé ou mis à crédit), et la facture est faite ;
--       - commission : le couvoir vend à l'éleveur ; HENZO AGRO touche
--         un montant par poussin ou un pourcentage du prix, à recevoir
--         du couvoir.
--   * Commande annulée : l'avance est rendue (par la finance) ou gardée.
--   * Comptabilité : avances clients (4191), commissions (7072).
-- À exécuter une fois dans Supabase > SQL Editor, après 0050.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Mouvements de caisse et comptes
-- ---------------------------------------------------------------------
alter table public.ecritures drop constraint ecritures_nature_check;
alter table public.ecritures add constraint ecritures_nature_check
  check (nature in ('vente', 'encaissement_creance', 'depense', 'paiement_fournisseur', 'solde_initial', 'correction', 'annulation',
                    'apport_investisseur', 'retrait_investisseur', 'versement_investisseur',
                    'pret_recu', 'remboursement_pret', 'ajustement_caisse', 'transfert', 'versement_boutique',
                    'avance_client', 'remboursement_avance', 'commission'));

create or replace function public.plan_comptable_defaut()
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
    ('vente_autres', '7028', 'Autres ventes de produits'), ('vente_marchandises', '7011', 'Ventes de marchandises'),
    ('clients_avances', '4191', 'Clients, avances et acomptes reçus'), ('commissions', '7072', 'Commissions et courtages')
$$;

insert into public.plan_comptable (ferme_id, cle, numero, intitule)
select f.id, d.cle, d.numero, d.intitule
from public.fermes f cross join public.plan_comptable_defaut() d
where d.cle in ('clients_avances', 'commissions')
on conflict (ferme_id, cle) do nothing;

-- ---------------------------------------------------------------------
-- 2. Commandes, avances, commissions reçues
-- ---------------------------------------------------------------------
create table public.commandes_eleveurs (
  id                 uuid primary key default gen_random_uuid(),
  ferme_id           uuid not null default public.ferme_actuelle() references public.fermes (id),
  client_id          uuid not null references public.tiers (id),
  couvoir_id         uuid references public.tiers (id),
  article_id         uuid references public.articles (id),
  souche             text,
  quantite           integer not null check (quantite > 0),
  date_livraison     date not null,
  prix_unitaire      numeric(14, 0) not null check (prix_unitaire >= 0),
  type_vente         text not null check (type_vente in ('revente', 'commission')),
  commission_mode    text check (commission_mode in ('fixe', 'pourcentage')),
  commission_valeur  numeric(14, 2) not null default 0 check (commission_valeur >= 0),
  statut             text not null default 'en_cours' check (statut in ('en_cours', 'livree', 'annulee')),
  quantite_livree    integer check (quantite_livree > 0),
  vente_id           uuid references public.ventes (id),
  commission_montant numeric(16, 0),
  livree_le          timestamptz,
  motif_annulation   text,
  avance_conservee   numeric(16, 0) not null default 0 check (avance_conservee >= 0),
  annulee_le         timestamptz,
  notes              text,
  saisi_par          uuid not null default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now(),
  check (type_vente = 'revente' or (commission_mode is not null and couvoir_id is not null)),
  check (type_vente = 'commission' or article_id is not null)
);
create index on public.commandes_eleveurs (ferme_id, date_livraison);
create trigger journal after insert or update on public.commandes_eleveurs for each row execute function public.journaliser();

create table public.avances_commandes (
  id             uuid primary key default gen_random_uuid(),
  ferme_id       uuid not null references public.fermes (id),
  commande_id    uuid not null references public.commandes_eleveurs (id),
  date_avance    date not null default current_date,
  sens           text not null check (sens in ('versement', 'remboursement')),
  montant        numeric(16, 0) not null check (montant > 0),
  mode_paiement  public.mode_paiement not null,
  saisi_par      uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index on public.avances_commandes (commande_id);
create trigger journal after insert on public.avances_commandes for each row execute function public.journaliser();
create trigger immuable before update or delete on public.avances_commandes for each row execute function public.registre_immuable();

create table public.commissions_recues (
  id             uuid primary key default gen_random_uuid(),
  ferme_id       uuid not null references public.fermes (id),
  couvoir_id     uuid not null references public.tiers (id),
  date_reception date not null default current_date,
  montant        numeric(16, 0) not null check (montant > 0),
  mode_paiement  public.mode_paiement not null,
  notes          text,
  saisi_par      uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);
create trigger journal after insert on public.commissions_recues for each row execute function public.journaliser();
create trigger immuable before update or delete on public.commissions_recues for each row execute function public.registre_immuable();

-- A sale made from an order: the deposit used on it
alter table public.ventes add column commande_id uuid references public.commandes_eleveurs (id);
alter table public.ventes add column avance_imputee numeric(16, 0) not null default 0 check (avance_imputee >= 0);

CREATE OR REPLACE FUNCTION public.avant_vente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_montant  numeric := round(new.quantite * new.prix_unitaire);
  v_client   public.tiers;
  v_statut   text;
begin
  -- a deposit paid on a chick order is set only by livrer_commande
  if new.commande_id is null then new.avance_imputee := 0; end if;
  if new.avance_imputee > v_montant then raise exception 'L''avance dépasse le montant de la vente'; end if;

  -- bande / lot vendable
  if new.bande_id is not null then
    select statut into v_statut from public.bandes where id = new.bande_id;
    if v_statut = 'cloturee' then raise exception 'Cette bande est clôturée'; end if;
  end if;
  if new.nombre_sujets is not null and new.nombre_sujets > public.oiseaux_restants(new.bande_id, new.lot_id) then
    raise exception 'Il ne reste que % oiseaux dans cette bande', public.oiseaux_restants(new.bande_id, new.lot_id);
  end if;

  -- vente à une société du groupe : toujours à crédit, payée par la société cliente (pas de plafond)
  select * into v_client from public.tiers where id = new.client_id;
  if v_client.ferme_liee_id is not null then
    new.a_credit := true;
    new.montant_encaisse := 0;
    new.mode_paiement := null;
  elsif not new.a_credit then
    if new.mode_paiement is null then raise exception 'Choisissez le mode de paiement'; end if;
    new.montant_encaisse := v_montant - new.avance_imputee;
  else
    if new.montant_encaisse + new.avance_imputee > v_montant then raise exception 'L''acompte dépasse le montant de la vente'; end if;
    if not v_client.credit_autorise then
      raise exception 'Le crédit n''est pas autorisé pour ce client';
    end if;
    if public.encours_client(new.client_id) + (v_montant - new.montant_encaisse - new.avance_imputee) > v_client.plafond_credit then
      raise exception 'Plafond de crédit dépassé pour ce client (plafond : % FCFA)', v_client.plafond_credit;
    end if;
  end if;

  -- prix du moment
  select prix into new.prix_reference from public.prix_vente
  where ferme_id = new.ferme_id and produit = new.produit and unite = new.unite and date_debut <= new.date_vente
  order by date_debut desc, created_at desc limit 1;

  new.annulee := false;
  new.annulee_par := null; new.annulee_le := null; new.motif_annulation := null;
  return new;
end;
$function$;

create or replace function public.reste_a_payer_vente(p_vente uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select v.montant - v.montant_encaisse - v.avance_imputee
         - coalesce((select sum(p.montant) from public.paiements_clients p where p.vente_id = v.id), 0)
  from public.ventes v where v.id = p_vente
$$;

-- Deposit still available on an order (paid − refunded − used on its sale − kept)
create function public.avance_disponible(p_commande uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(case a.sens when 'versement' then a.montant else -a.montant end) from public.avances_commandes a where a.commande_id = c.id), 0)
       - coalesce((select sum(v.avance_imputee) from public.ventes v where v.commande_id = c.id and not v.annulee), 0)
       - c.avance_conservee
  from public.commandes_eleveurs c where c.id = p_commande
$$;

-- ---------------------------------------------------------------------
-- 3. Les actions
-- ---------------------------------------------------------------------
create function public.creer_commande_eleveur(p_client uuid, p_couvoir uuid, p_article uuid, p_souche text, p_quantite integer,
                                               p_date date, p_prix numeric, p_type text, p_commission_mode text default null,
                                               p_commission_valeur numeric default 0, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.a_role('exploitation', 'employe') then raise exception 'Seuls l''exploitation et les employés prennent les commandes'; end if;
  if (select type_activite from public.fermes where id = public.ferme_actuelle()) <> 'negoce' then
    raise exception 'Les commandes de poussins se prennent dans HENZO AGRO';
  end if;
  if not exists (select 1 from public.tiers where id = p_client and ferme_id = public.ferme_actuelle() and type_tiers <> 'fournisseur') then
    raise exception 'Choisissez le client';
  end if;
  if p_couvoir is not null and not exists (select 1 from public.tiers where id = p_couvoir and ferme_id = public.ferme_actuelle() and type_tiers <> 'client') then
    raise exception 'Couvoir introuvable';
  end if;
  if p_type = 'revente' and not exists (select 1 from public.articles where id = p_article and ferme_id = public.ferme_actuelle() and categorie = 'poussins') then
    raise exception 'Choisissez l''article poussins (dans le stock)';
  end if;
  if p_type = 'commission' and p_couvoir is null then raise exception 'Choisissez le couvoir qui paie la commission'; end if;
  if p_type = 'commission' and p_commission_mode = 'pourcentage' and coalesce(p_commission_valeur, 0) > 100 then
    raise exception 'Pourcentage impossible';
  end if;
  insert into public.commandes_eleveurs (ferme_id, client_id, couvoir_id, article_id, souche, quantite, date_livraison, prix_unitaire,
                                         type_vente, commission_mode, commission_valeur, notes)
  values (public.ferme_actuelle(), p_client, p_couvoir, case when p_type = 'revente' then p_article end, nullif(trim(coalesce(p_souche, '')), ''),
          p_quantite, p_date, round(coalesce(p_prix, 0)), p_type, case when p_type = 'commission' then p_commission_mode end,
          case when p_type = 'commission' then coalesce(p_commission_valeur, 0) else 0 end, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.verser_avance_commande(p_commande uuid, p_montant numeric, p_mode public.mode_paiement, p_date date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.commandes_eleveurs;
  v_client text;
begin
  if not public.a_role('exploitation', 'employe') then raise exception 'Seuls l''exploitation et les employés encaissent les avances'; end if;
  select * into c from public.commandes_eleveurs where id = p_commande and ferme_id = public.ferme_actuelle() for update;
  if c.id is null then raise exception 'Commande introuvable'; end if;
  if c.statut <> 'en_cours' then raise exception 'Cette commande est déjà livrée ou annulée'; end if;
  if c.type_vente = 'commission' then raise exception 'En commission, l''éleveur paie le couvoir directement'; end if;
  if coalesce(p_montant, 0) <= 0 then raise exception 'Indiquez le montant de l''avance'; end if;
  if public.avance_disponible(c.id) + p_montant > c.quantite * c.prix_unitaire then
    raise exception 'L''avance dépasse le montant de la commande (% FCFA)', c.quantite * c.prix_unitaire;
  end if;
  select nom into v_client from public.tiers where id = c.client_id;
  insert into public.avances_commandes (ferme_id, commande_id, date_avance, sens, montant, mode_paiement)
  values (c.ferme_id, c.id, coalesce(p_date, current_date), 'versement', round(p_montant), p_mode);
  perform public.ecrire(c.ferme_id, public.caisse_de(c.ferme_id, 'chair', p_mode), 'entree', round(p_montant), 'avance_client',
                        'Avance commande poussins – ' || v_client, coalesce(p_date, current_date));
end;
$$;

-- Delivery: resale = a sale from stock (deposit deducted, the rest paid now or on credit, invoice made);
-- commission = the commission is due by the hatchery
create function public.livrer_commande(p_commande uuid, p_quantite integer, p_mode public.mode_paiement default null,
                                       p_paye numeric default 0, p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.commandes_eleveurs;
  v_montant numeric;
  v_avance numeric;
  v_paye numeric := round(coalesce(p_paye, 0));
  v_reste numeric;
  v_vente uuid;
begin
  if not public.a_role('exploitation', 'employe') then raise exception 'Seuls l''exploitation et les employés livrent les commandes'; end if;
  select * into c from public.commandes_eleveurs where id = p_commande and ferme_id = public.ferme_actuelle() for update;
  if c.id is null then raise exception 'Commande introuvable'; end if;
  if c.statut <> 'en_cours' then raise exception 'Cette commande est déjà livrée ou annulée'; end if;
  if coalesce(p_quantite, 0) <= 0 then raise exception 'Indiquez le nombre de poussins livrés'; end if;

  if c.type_vente = 'commission' then
    update public.commandes_eleveurs set statut = 'livree', quantite_livree = p_quantite, livree_le = now(),
      commission_montant = round(case when c.commission_mode = 'fixe' then p_quantite * c.commission_valeur
                                      else p_quantite * c.prix_unitaire * c.commission_valeur / 100 end)
    where id = c.id;
    return null;
  end if;

  v_montant := round(p_quantite * c.prix_unitaire);
  v_avance := least(public.avance_disponible(c.id), v_montant);
  if v_paye < 0 then raise exception 'Montant payé impossible'; end if;
  v_reste := v_montant - v_avance - v_paye;
  if v_reste < 0 then raise exception 'Le paiement dépasse le reste à payer (% FCFA)', v_montant - v_avance; end if;
  if v_paye > 0 and p_mode is null then raise exception 'Choisissez le mode de paiement'; end if;
  insert into public.ventes (ferme_id, client_id, produit, article_id, unite, quantite, prix_unitaire, date_vente,
                             a_credit, montant_encaisse, mode_paiement, avance_imputee, commande_id, notes)
  values (c.ferme_id, c.client_id, 'marchandise', c.article_id, 'piece', p_quantite, c.prix_unitaire, coalesce(p_date, current_date),
          v_reste > 0, v_paye, coalesce(p_mode, 'especes'), v_avance, c.id,
          'Commande de poussins' || coalesce(' (' || c.souche || ')', ''))
  returning id into v_vente;
  update public.commandes_eleveurs set statut = 'livree', quantite_livree = p_quantite, vente_id = v_vente, livree_le = now() where id = c.id;
  return v_vente;
end;
$$;

create function public.annuler_commande(p_commande uuid, p_motif text, p_rembourser boolean default false, p_mode public.mode_paiement default 'especes')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.commandes_eleveurs;
  v_avance numeric;
  v_client text;
begin
  if not public.a_role('exploitation', 'finance') then raise exception 'Seuls l''exploitation et la finance annulent une commande'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif'; end if;
  select * into c from public.commandes_eleveurs where id = p_commande and ferme_id = public.ferme_actuelle() for update;
  if c.id is null then raise exception 'Commande introuvable'; end if;
  if c.statut <> 'en_cours' then raise exception 'Cette commande est déjà livrée ou annulée'; end if;
  v_avance := public.avance_disponible(c.id);
  if v_avance > 0 and p_rembourser then
    if not public.a_role('finance') then raise exception 'Le remboursement de l''avance est fait par la finance (Dahirou)'; end if;
    select nom into v_client from public.tiers where id = c.client_id;
    insert into public.avances_commandes (ferme_id, commande_id, sens, montant, mode_paiement)
    values (c.ferme_id, c.id, 'remboursement', v_avance, p_mode);
    perform public.ecrire(c.ferme_id, public.caisse_de(c.ferme_id, 'chair', p_mode), 'sortie', v_avance, 'remboursement_avance',
                          'Avance rendue – ' || v_client, current_date);
  end if;
  update public.commandes_eleveurs set statut = 'annulee', motif_annulation = trim(p_motif), annulee_le = now(),
    avance_conservee = case when v_avance > 0 and not p_rembourser then v_avance else 0 end
  where id = c.id;
end;
$$;

-- A sale made from an order is cancelled: the order is open again and its deposit available again
create function public.annulation_vente_commande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.annulee and not old.annulee and new.commande_id is not null then
    update public.commandes_eleveurs set statut = 'en_cours', quantite_livree = null, vente_id = null, livree_le = null
    where id = new.commande_id and vente_id = new.id;
  end if;
  return null;
end;
$$;
create trigger annulation_vente_commande after update of annulee on public.ventes
  for each row execute function public.annulation_vente_commande();

create function public.recevoir_commission(p_couvoir uuid, p_montant numeric, p_mode public.mode_paiement, p_date date default current_date, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nom text;
begin
  if not public.a_role('finance') then raise exception 'Seule la finance (Dahirou) enregistre les commissions reçues'; end if;
  select nom into v_nom from public.tiers where id = p_couvoir and ferme_id = public.ferme_actuelle();
  if v_nom is null then raise exception 'Couvoir introuvable'; end if;
  if coalesce(p_montant, 0) <= 0 then raise exception 'Indiquez le montant reçu'; end if;
  insert into public.commissions_recues (ferme_id, couvoir_id, date_reception, montant, mode_paiement, notes)
  values (public.ferme_actuelle(), p_couvoir, coalesce(p_date, current_date), round(p_montant), p_mode, nullif(trim(coalesce(p_notes, '')), ''));
  perform public.ecrire(public.ferme_actuelle(), public.caisse_de(public.ferme_actuelle(), 'chair', p_mode), 'entree', round(p_montant),
                        'commission', 'Commission reçue – ' || v_nom, coalesce(p_date, current_date));
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Lecture
-- ---------------------------------------------------------------------
create view public.commandes_eleveurs_situation with (security_invoker = true) as
select c.*, cl.nom as client_nom, co.nom as couvoir_nom, a.nom as article_nom,
       round(c.quantite * c.prix_unitaire) as montant_commande,
       coalesce((select sum(case x.sens when 'versement' then x.montant else -x.montant end) from public.avances_commandes x where x.commande_id = c.id), 0) as avances_nettes,
       public.avance_disponible(c.id) as avance_disponible,
       case when c.vente_id is not null then public.reste_a_payer_vente(c.vente_id) end as reste_vente
from public.commandes_eleveurs c
left join public.tiers cl on cl.id = c.client_id
left join public.tiers co on co.id = c.couvoir_id
left join public.articles a on a.id = c.article_id;

create view public.commissions_couvoirs with (security_invoker = true) as
select t.id as couvoir_id, t.nom,
       coalesce((select sum(c.commission_montant) from public.commandes_eleveurs c where c.couvoir_id = t.id and c.statut = 'livree'), 0) as due,
       coalesce((select sum(r.montant) from public.commissions_recues r where r.couvoir_id = t.id), 0) as recue
from public.tiers t
where exists (select 1 from public.commandes_eleveurs c where c.couvoir_id = t.id and c.type_vente = 'commission');

alter table public.commandes_eleveurs enable row level security;
alter table public.avances_commandes enable row level security;
alter table public.commissions_recues enable row level security;
create policy commandes_select on public.commandes_eleveurs for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'employe', 'comptable'));
create policy avances_commandes_select on public.avances_commandes for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'employe', 'comptable'));
create policy commissions_select on public.commissions_recues for select to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'comptable'));

revoke all on public.commandes_eleveurs, public.avances_commandes, public.commissions_recues,
              public.commandes_eleveurs_situation, public.commissions_couvoirs from anon;
revoke execute on function public.avance_disponible(uuid), public.annulation_vente_commande() from public, anon;
revoke execute on function public.annulation_vente_commande() from authenticated;
grant execute on function public.avance_disponible(uuid) to authenticated;   -- read by the orders view, with the reader's rights
revoke execute on function public.creer_commande_eleveur(uuid, uuid, uuid, text, integer, date, numeric, text, text, numeric, text),
                          public.verser_avance_commande(uuid, numeric, public.mode_paiement, date),
                          public.livrer_commande(uuid, integer, public.mode_paiement, numeric, date),
                          public.annuler_commande(uuid, text, boolean, public.mode_paiement),
                          public.recevoir_commission(uuid, numeric, public.mode_paiement, date, text) from public, anon;
grant execute on function public.creer_commande_eleveur(uuid, uuid, uuid, text, integer, date, numeric, text, text, numeric, text),
                          public.verser_avance_commande(uuid, numeric, public.mode_paiement, date),
                          public.livrer_commande(uuid, integer, public.mode_paiement, numeric, date),
                          public.annuler_commande(uuid, text, boolean, public.mode_paiement),
                          public.recevoir_commission(uuid, numeric, public.mode_paiement, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Journal comptable
-- ---------------------------------------------------------------------
create or replace view public.journal_comptable_brut with (security_invoker = true) as
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
      when 'avance_client' then 'clients_avances'
      when 'remboursement_avance' then 'clients_avances'
      when 'commission' then 'commissions'
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
                             when 'poules_reformees' then 'vente_reformees' when 'fientes' then 'vente_fientes' when 'marchandise' then 'vente_marchandises' else 'vente_autres' end as cle_produit,
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
  -- deposit paid on a chick order, used on its sale: the client owes that much less
  union all
  select ferme_id, date_vente, 'OD', 'V-' || left(id::text, 8), 'Avance déduite', 'clients_avances', avance_imputee, 0, 'vente', id
  from public.ventes where avance_imputee > 0 and not annulee
  union all
  select ferme_id, date_vente, 'OD', 'V-' || left(id::text, 8), 'Avance déduite', 'clients', 0, avance_imputee, 'vente', id
  from public.ventes where avance_imputee > 0 and not annulee
  -- deposit kept when an order is cancelled
  union all
  select ferme_id, annulee_le::date, 'OD', 'C-' || left(id::text, 8), 'Avance conservée (commande annulée)', 'clients_avances', avance_conservee, 0, 'commande', id
  from public.commandes_eleveurs where avance_conservee > 0
  union all
  select ferme_id, annulee_le::date, 'OD', 'C-' || left(id::text, 8), 'Avance conservée (commande annulée)', 'produits_divers', 0, avance_conservee, 'commande', id
  from public.commandes_eleveurs where avance_conservee > 0
)
select * from mouvements
union all select * from ventes
union all select * from achats
union all select * from paie
union all select * from od;
