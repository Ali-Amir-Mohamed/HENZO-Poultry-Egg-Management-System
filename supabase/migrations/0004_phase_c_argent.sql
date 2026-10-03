-- =====================================================================
-- HENZO – Phase C : investisseurs, prêts, vérification de caisse
-- À exécuter une fois dans Supabase > SQL Editor, après 0003.
--
--   * registre séparé du capital de chaque investisseur (apports,
--     réinvestissements, retraits), même si l'argent est dans la caisse commune ;
--   * à chaque clôture validée d'une bande de chair : 10 % du capital restant
--     de chaque investisseur est dû ; l'investisseur choisit retrait (sortie de
--     caisse) ou réinvestissement (ajout au capital) ;
--   * prêts (banque / particulier) : entrée en caisse, échéancier,
--     remboursements (éventuellement liés à une fin de bande), solde ;
--   * vérification de caisse : solde théorique vs argent compté, écart justifié ;
--     seul le directeur peut passer l'écriture d'ajustement ;
--   * gestion : directeur et finance ; lecture : exploitation ; employé : rien ;
--   * rien ne se modifie : seul le directeur annule, avec motif (écriture inverse).
-- =====================================================================

alter table public.fermes
  add column taux_investisseurs numeric(5, 2) not null default 10 check (taux_investisseurs between 0 and 100);

-- ---------------------------------------------------------------------
-- 1. Registre des écritures : nouvelles natures + lien générique vers l'origine
-- ---------------------------------------------------------------------
alter table public.ecritures drop constraint ecritures_nature_check;
alter table public.ecritures add constraint ecritures_nature_check
  check (nature in ('vente', 'encaissement_creance', 'depense', 'paiement_fournisseur', 'solde_initial', 'correction', 'annulation',
                    'apport_investisseur', 'retrait_investisseur', 'versement_investisseur',
                    'pret_recu', 'remboursement_pret', 'ajustement_caisse'));
alter table public.ecritures add column source_id uuid;
create index on public.ecritures (source_id);

create function public.ecrire_source(p_ferme uuid, p_caisse uuid, p_sens text, p_montant numeric, p_nature text,
                                     p_libelle text, p_date date, p_source uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ecritures (ferme_id, caisse_id, sens, montant, nature, libelle, date_operation, source_id)
  values (p_ferme, p_caisse, p_sens, p_montant, p_nature, p_libelle, p_date, p_source)
$$;

create function public.contre_passer_source(p_source uuid, p_motif text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ecritures (ferme_id, caisse_id, sens, montant, nature, libelle, date_operation, source_id, ecriture_corrigee_id)
  select e.ferme_id, e.caisse_id, case e.sens when 'entree' then 'sortie' else 'entree' end, e.montant,
         'annulation', p_motif, current_date, e.source_id, e.id
  from public.ecritures e
  where e.source_id = p_source and e.nature <> 'annulation'
    and not exists (select 1 from public.ecritures x where x.ecriture_corrigee_id = e.id and x.nature = 'annulation')
$$;

create function public.solde_caisse(p_caisse uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case sens when 'entree' then montant else -montant end), 0)
  from public.ecritures where caisse_id = p_caisse
$$;

-- Annulation générique : seul le directeur, avec motif, rien d'autre ne change
create function public.controle_annulation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  libres text[] := array['annulee', 'motif_annulation', 'annulee_par', 'annulee_le'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Cette opération ne se supprime pas : le directeur peut l''annuler';
  end if;
  if auth.uid() is not null and not public.a_role('directeur') then
    raise exception 'Seul le directeur peut annuler cette opération';
  end if;
  if old.annulee or not new.annulee or coalesce(trim(new.motif_annulation), '') = ''
     or (to_jsonb(new) - libres) is distinct from (to_jsonb(old) - libres) then
    raise exception 'Cette opération ne se modifie pas : seule une annulation avec motif est possible';
  end if;
  new.annulee_par := auth.uid();
  new.annulee_le := now();
  return new;
end;
$$;

create function public.apres_annulation_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.contre_passer_source(new.id, 'Annulation : ' || new.motif_annulation);
  perform public.notifier(new.ferme_id, 'directeur', 'annulation', 'Opération annulée (' || tg_table_name || ') : ' || new.motif_annulation);
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Investisseurs
-- ---------------------------------------------------------------------
create table public.investisseurs (
  id              uuid primary key default gen_random_uuid(),
  ferme_id        uuid not null default public.ferme_actuelle() references public.fermes (id),
  nom             text not null,
  telephone       text,
  adresse         text,
  piece_identite  text,
  notes           text,
  actif           boolean not null default true,
  created_at      timestamptz not null default now()
);

create table public.operations_investisseurs (
  id                uuid primary key default gen_random_uuid(),
  ferme_id          uuid not null default public.ferme_actuelle() references public.fermes (id),
  investisseur_id   uuid not null references public.investisseurs (id),
  date_operation    date not null default current_date,
  type_operation    text not null check (type_operation in ('apport', 'reinvestissement', 'retrait_capital')),
  montant           numeric(16, 0) not null check (montant > 0),
  activite          public.activite,          -- caisse concernée (apport / retrait)
  mode_paiement     public.mode_paiement,
  distribution_id   uuid,                     -- réinvestissement des 10 %
  notes             text,
  annulee           boolean not null default false,
  annulee_par       uuid references public.profiles (id),
  annulee_le        timestamptz,
  motif_annulation  text,
  saisi_par         uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now(),
  check (type_operation = 'reinvestissement' or (activite is not null and mode_paiement is not null))
);
create index on public.operations_investisseurs (investisseur_id);

create table public.distributions_investisseurs (
  id               uuid primary key default gen_random_uuid(),
  ferme_id         uuid not null references public.fermes (id),
  investisseur_id  uuid not null references public.investisseurs (id),
  bande_id         uuid not null references public.bandes (id),
  capital_base     numeric(16, 0) not null,
  taux             numeric(5, 2) not null,
  montant          numeric(16, 0) not null check (montant >= 0),
  statut           text not null default 'en_attente' check (statut in ('en_attente', 'retire', 'reinvesti')),
  mode_paiement    public.mode_paiement,
  decide_le        timestamptz,
  decide_par       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  unique (investisseur_id, bande_id)
);
alter table public.operations_investisseurs
  add constraint operations_distribution_fk foreign key (distribution_id) references public.distributions_investisseurs (id);

create function public.capital_restant(p_investisseur uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case type_operation when 'retrait_capital' then -montant else montant end), 0)
  from public.operations_investisseurs where investisseur_id = p_investisseur and not annulee
$$;

create function public.avant_operation_investisseur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type_operation = 'retrait_capital' and new.montant > public.capital_restant(new.investisseur_id) then
    raise exception 'Le retrait dépasse le capital restant (% FCFA)', public.capital_restant(new.investisseur_id);
  end if;
  new.ferme_id := (select ferme_id from public.investisseurs where id = new.investisseur_id);
  new.annulee := false;
  new.annulee_par := null; new.annulee_le := null; new.motif_annulation := null;
  return new;
end;
$$;
create trigger avant_operation before insert on public.operations_investisseurs
  for each row execute function public.avant_operation_investisseur();

create function public.apres_operation_investisseur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nom text := (select nom from public.investisseurs where id = new.investisseur_id);
begin
  if new.type_operation = 'apport' then
    perform public.ecrire_source(new.ferme_id, public.caisse_de(new.ferme_id, new.activite, new.mode_paiement), 'entree',
                                 new.montant, 'apport_investisseur', 'Apport de ' || v_nom, new.date_operation, new.id);
  elsif new.type_operation = 'retrait_capital' then
    perform public.ecrire_source(new.ferme_id, public.caisse_de(new.ferme_id, new.activite, new.mode_paiement), 'sortie',
                                 new.montant, 'retrait_investisseur', 'Retrait de capital de ' || v_nom, new.date_operation, new.id);
    perform public.notifier(new.ferme_id, 'directeur', 'retrait_investisseur',
                            format('Retrait de capital de %s FCFA par %s', new.montant, v_nom));
  end if;
  return null;
end;
$$;
create trigger apres_operation after insert on public.operations_investisseurs
  for each row execute function public.apres_operation_investisseur();

-- Un réinvestissement des 10 % ne s'annule pas seul (il découle d'une décision)
create function public.controle_annulation_operation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.type_operation = 'reinvestissement' then
    raise exception 'Un réinvestissement des 10 %% ne s''annule pas : passez une correction';
  end if;
  return new;
end;
$$;
create trigger a_controle_reinvestissement before update on public.operations_investisseurs
  for each row execute function public.controle_annulation_operation();
create trigger b_controle_annulation before update or delete on public.operations_investisseurs
  for each row execute function public.controle_annulation();
create trigger apres_annulation after update of annulee on public.operations_investisseurs
  for each row when (new.annulee and not old.annulee) execute function public.apres_annulation_source();
create trigger journal after insert or update on public.operations_investisseurs
  for each row execute function public.journaliser();

-- 10 % dus à la clôture validée d'une bande de chair
create function public.creer_distributions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taux numeric := (select taux_investisseurs from public.fermes where id = new.ferme_id);
  v_total numeric;
begin
  insert into public.distributions_investisseurs (ferme_id, investisseur_id, bande_id, capital_base, taux, montant)
  select new.ferme_id, i.id, new.id, c.capital, v_taux, round(c.capital * v_taux / 100)
  from public.investisseurs i
  cross join lateral (select public.capital_restant(i.id) as capital) c
  where i.ferme_id = new.ferme_id and i.actif and c.capital > 0;

  select sum(montant) into v_total from public.distributions_investisseurs where bande_id = new.id;
  if v_total > 0 then
    perform public.notifier(new.ferme_id, 'finance', 'distribution',
      format('Clôture de %s : %s FCFA à verser ou réinvestir pour les investisseurs', new.code, v_total), '/argent');
    perform public.notifier(new.ferme_id, 'directeur', 'distribution',
      format('Clôture de %s : %s FCFA à verser ou réinvestir pour les investisseurs', new.code, v_total), '/argent');
  end if;
  return null;
end;
$$;
create trigger creer_distributions after update of statut on public.bandes
  for each row when (new.statut = 'cloturee' and old.statut <> 'cloturee')
  execute function public.creer_distributions();

-- Décision de l'investisseur : retrait ou réinvestissement (une seule fois)
create function public.controle_distribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  libres text[] := array['statut', 'mode_paiement', 'decide_le', 'decide_par'];
begin
  if tg_op = 'DELETE' then raise exception 'Une distribution ne se supprime pas'; end if;
  if (to_jsonb(new) - libres) is distinct from (to_jsonb(old) - libres)
     or old.statut <> 'en_attente' or new.statut not in ('retire', 'reinvesti') then
    raise exception 'La décision sur les 10 %% se prend une seule fois : retrait ou réinvestissement';
  end if;
  if auth.uid() is not null and not public.a_role('directeur', 'finance') then
    raise exception 'Seuls le directeur et la finance enregistrent cette décision';
  end if;
  if new.statut = 'retire' and new.mode_paiement is null then
    raise exception 'Choisissez le mode de paiement du versement';
  end if;
  if new.statut = 'reinvesti' then new.mode_paiement := null; end if;
  new.decide_le := now();
  new.decide_par := auth.uid();
  return new;
end;
$$;
create trigger controle_distribution before update or delete on public.distributions_investisseurs
  for each row execute function public.controle_distribution();

create function public.apres_distribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nom text := (select nom from public.investisseurs where id = new.investisseur_id);
begin
  if new.statut = 'retire' and new.montant > 0 then
    perform public.ecrire_source(new.ferme_id, public.caisse_de(new.ferme_id, 'chair', new.mode_paiement), 'sortie',
                                 new.montant, 'versement_investisseur', '10 % versés à ' || v_nom, current_date, new.id);
  elsif new.statut = 'reinvesti' and new.montant > 0 then
    insert into public.operations_investisseurs (ferme_id, investisseur_id, type_operation, montant, distribution_id, notes, saisi_par)
    values (new.ferme_id, new.investisseur_id, 'reinvestissement', new.montant, new.id, '10 % réinvestis',
            coalesce(auth.uid(), (select saisi_par from public.operations_investisseurs where investisseur_id = new.investisseur_id limit 1)));
  end if;
  return null;
end;
$$;
create trigger apres_distribution after update of statut on public.distributions_investisseurs
  for each row execute function public.apres_distribution();
create trigger journal after insert or update on public.distributions_investisseurs
  for each row execute function public.journaliser();

-- ---------------------------------------------------------------------
-- 3. Prêts
-- ---------------------------------------------------------------------
create table public.prets (
  id                uuid primary key default gen_random_uuid(),
  ferme_id          uuid not null default public.ferme_actuelle() references public.fermes (id),
  type_preteur      text not null check (type_preteur in ('banque', 'particulier')),
  preteur           text not null,
  contact           text,
  date_pret         date not null default current_date,
  montant_initial   numeric(16, 0) not null check (montant_initial > 0),
  interets          numeric(16, 0) not null default 0 check (interets >= 0),   -- intérêts totaux convenus
  activite          public.activite not null,                                 -- activité concernée = caisse qui reçoit
  mode_paiement     public.mode_paiement not null,
  notes             text,
  annulee           boolean not null default false,
  annulee_par       uuid references public.profiles (id),
  annulee_le        timestamptz,
  motif_annulation  text,
  saisi_par         uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now()
);

create table public.echeances_prets (
  id             uuid primary key default gen_random_uuid(),
  ferme_id       uuid not null default public.ferme_actuelle() references public.fermes (id),
  pret_id        uuid not null references public.prets (id) on delete cascade,
  date_echeance  date not null,
  montant        numeric(16, 0) not null check (montant > 0),
  created_at     timestamptz not null default now()
);
create index on public.echeances_prets (pret_id, date_echeance);

create table public.remboursements_prets (
  id                  uuid primary key default gen_random_uuid(),
  ferme_id            uuid not null default public.ferme_actuelle() references public.fermes (id),
  pret_id             uuid not null references public.prets (id),
  date_remboursement  date not null default current_date,
  montant             numeric(16, 0) not null check (montant > 0),
  mode_paiement       public.mode_paiement not null,
  bande_id            uuid references public.bandes (id),      -- remboursement lié à une fin de bande
  notes               text,
  annulee             boolean not null default false,
  annulee_par         uuid references public.profiles (id),
  annulee_le          timestamptz,
  motif_annulation    text,
  saisi_par           uuid not null default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now()
);
create index on public.remboursements_prets (pret_id);

create function public.solde_pret(p_pret uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select p.montant_initial + p.interets
         - coalesce((select sum(r.montant) from public.remboursements_prets r where r.pret_id = p.id and not r.annulee), 0)
  from public.prets p where p.id = p_pret
$$;

create function public.apres_pret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ecrire_source(new.ferme_id, public.caisse_de(new.ferme_id, new.activite, new.mode_paiement), 'entree',
                               new.montant_initial, 'pret_recu', 'Prêt de ' || new.preteur, new.date_pret, new.id);
  return null;
end;
$$;
create trigger apres_pret after insert on public.prets
  for each row execute function public.apres_pret();

create function public.controle_annulation_pret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.annulee and exists (select 1 from public.remboursements_prets where pret_id = old.id and not annulee) then
    raise exception 'Annulez d''abord les remboursements de ce prêt';
  end if;
  return new;
end;
$$;
create trigger a_controle_remboursements before update on public.prets
  for each row execute function public.controle_annulation_pret();
create trigger b_controle_annulation before update or delete on public.prets
  for each row execute function public.controle_annulation();
create trigger apres_annulation after update of annulee on public.prets
  for each row when (new.annulee and not old.annulee) execute function public.apres_annulation_source();
create trigger journal after insert or update on public.prets
  for each row execute function public.journaliser();

create function public.avant_remboursement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.prets;
begin
  select * into p from public.prets where id = new.pret_id;
  if p.annulee then raise exception 'Ce prêt est annulé'; end if;
  if new.montant > public.solde_pret(p.id) then
    raise exception 'Le remboursement dépasse le solde du prêt (% FCFA)', public.solde_pret(p.id);
  end if;
  new.ferme_id := p.ferme_id;
  new.annulee := false;
  new.annulee_par := null; new.annulee_le := null; new.motif_annulation := null;
  return new;
end;
$$;
create trigger avant_remboursement before insert on public.remboursements_prets
  for each row execute function public.avant_remboursement();

create function public.apres_remboursement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.prets;
begin
  select * into p from public.prets where id = new.pret_id;
  perform public.ecrire_source(new.ferme_id, public.caisse_de(new.ferme_id, p.activite, new.mode_paiement), 'sortie',
                               new.montant, 'remboursement_pret', 'Remboursement prêt ' || p.preteur, new.date_remboursement, new.id);
  return null;
end;
$$;
create trigger apres_remboursement after insert on public.remboursements_prets
  for each row execute function public.apres_remboursement();
create trigger controle_annulation before update or delete on public.remboursements_prets
  for each row execute function public.controle_annulation();
create trigger apres_annulation after update of annulee on public.remboursements_prets
  for each row when (new.annulee and not old.annulee) execute function public.apres_annulation_source();
create trigger journal after insert or update on public.remboursements_prets
  for each row execute function public.journaliser();

-- ---------------------------------------------------------------------
-- 4. Vérification de caisse
-- ---------------------------------------------------------------------
create table public.verifications_caisse (
  id                 uuid primary key default gen_random_uuid(),
  ferme_id           uuid not null default public.ferme_actuelle() references public.fermes (id),
  caisse_id          uuid not null references public.caisses (id),
  date_verification  date not null default current_date,
  solde_theorique    numeric(16, 0) not null default 0,       -- rempli automatiquement
  montant_compte     numeric(16, 0) not null check (montant_compte >= 0),
  ecart              numeric(16, 0) generated always as (montant_compte - solde_theorique) stored,
  justification      text,
  ajustement         boolean not null default false,          -- écriture d'ajustement (directeur)
  saisi_par          uuid not null default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now()
);
create index on public.verifications_caisse (caisse_id, date_verification);

create function public.avant_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.solde_theorique := public.solde_caisse(new.caisse_id);
  new.ferme_id := (select ferme_id from public.caisses where id = new.caisse_id);
  if new.montant_compte <> new.solde_theorique and coalesce(trim(new.justification), '') = '' then
    raise exception 'Écart de % FCFA : une justification est obligatoire', new.montant_compte - new.solde_theorique;
  end if;
  if new.ajustement and auth.uid() is not null and not public.a_role('directeur') then
    raise exception 'Seul le directeur peut ajuster le solde d''une caisse';
  end if;
  if new.montant_compte = new.solde_theorique then new.ajustement := false; end if;
  return new;
end;
$$;
create trigger avant_verification before insert on public.verifications_caisse
  for each row execute function public.avant_verification();

create function public.apres_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ecart <> 0 then
    perform public.notifier(new.ferme_id, 'directeur', 'ecart_caisse',
      format('Écart de caisse de %s FCFA : %s', new.ecart, new.justification), '/argent');
    if new.ajustement then
      perform public.ecrire_source(new.ferme_id, new.caisse_id, case when new.ecart > 0 then 'entree' else 'sortie' end,
                                   abs(new.ecart), 'ajustement_caisse', 'Ajustement après vérification : ' || new.justification,
                                   new.date_verification, new.id);
    end if;
  end if;
  return null;
end;
$$;
create trigger apres_verification after insert on public.verifications_caisse
  for each row execute function public.apres_verification();
create trigger immuable before update or delete on public.verifications_caisse
  for each row execute function public.registre_immuable();
create trigger journal after insert on public.verifications_caisse
  for each row execute function public.journaliser();

-- ---------------------------------------------------------------------
-- 5. Vues de situation
-- ---------------------------------------------------------------------
create view public.situation_investisseurs with (security_invoker = true) as
select i.id as investisseur_id, i.ferme_id, i.nom, i.telephone, i.actif,
       coalesce((select sum(o.montant) from public.operations_investisseurs o
                 where o.investisseur_id = i.id and not o.annulee and o.type_operation = 'apport'), 0) as capital_apporte,
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

create view public.situation_prets with (security_invoker = true) as
with remb as (
  select pret_id, sum(montant) as rembourse from public.remboursements_prets where not annulee group by pret_id
)
select p.id as pret_id, p.ferme_id, p.type_preteur, p.preteur, p.contact, p.date_pret, p.activite,
       p.montant_initial, p.interets, p.montant_initial + p.interets as montant_du,
       coalesce(r.rembourse, 0) as rembourse,
       p.montant_initial + p.interets - coalesce(r.rembourse, 0) as solde,
       -- prochaine échéance non couverte par les remboursements
       (select min(e.date_echeance) from public.echeances_prets e
        where e.pret_id = p.id
          and (select sum(e2.montant) from public.echeances_prets e2
               where e2.pret_id = p.id and e2.date_echeance <= e.date_echeance) > coalesce(r.rembourse, 0)) as prochaine_echeance,
       coalesce((select sum(e.montant) from public.echeances_prets e
                 where e.pret_id = p.id and e.date_echeance < current_date), 0) > coalesce(r.rembourse, 0) as en_retard
from public.prets p
left join remb r on r.pret_id = p.id
where not p.annulee;

create view public.capitaux_engages with (security_invoker = true) as
select (select coalesce(sum(capital_restant), 0) from public.situation_investisseurs) as capital_investisseurs,
       (select coalesce(sum(solde), 0) from public.situation_prets) as solde_prets,
       (select coalesce(sum(montant), 0) from public.distributions_investisseurs where statut = 'en_attente') as dix_pourcent_en_attente;

-- ---------------------------------------------------------------------
-- 6. Sécurité (RLS)
-- ---------------------------------------------------------------------
alter table public.investisseurs               enable row level security;
alter table public.operations_investisseurs    enable row level security;
alter table public.distributions_investisseurs enable row level security;
alter table public.prets                       enable row level security;
alter table public.echeances_prets             enable row level security;
alter table public.remboursements_prets        enable row level security;
alter table public.verifications_caisse        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['investisseurs', 'operations_investisseurs', 'distributions_investisseurs', 'prets',
                           'echeances_prets', 'remboursements_prets', 'verifications_caisse'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance'));
    $f$, t);
  end loop;
end;
$$;

create policy investisseurs_insert on public.investisseurs for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));
create policy investisseurs_update on public.investisseurs for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));

create policy operations_insert on public.operations_investisseurs for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid()
              and type_operation in ('apport', 'retrait_capital') and public.a_role('directeur', 'finance'));
create policy operations_update on public.operations_investisseurs for update to authenticated   -- annulation (trigger)
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));

create policy distributions_update on public.distributions_investisseurs for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));

create policy prets_insert on public.prets for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and public.a_role('directeur', 'finance'));
create policy prets_update on public.prets for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));

create policy echeances_write on public.echeances_prets for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance'));

create policy remboursements_insert on public.remboursements_prets for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and public.a_role('directeur', 'finance'));
create policy remboursements_update on public.remboursements_prets for update to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));

create policy verifications_insert on public.verifications_caisse for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and public.a_role('directeur', 'finance'));

-- Fonctions internes non appelables depuis l'appli ; aucun accès anonyme
revoke execute on function public.ecrire_source(uuid, uuid, text, numeric, text, text, date, uuid) from public, anon, authenticated;
revoke execute on function public.contre_passer_source(uuid, text) from public, anon, authenticated;
revoke execute on function public.solde_caisse(uuid) from public, anon, authenticated;
revoke execute on function public.capital_restant(uuid) from public, anon, authenticated;
revoke execute on function public.solde_pret(uuid) from public, anon, authenticated;
revoke all on public.investisseurs, public.operations_investisseurs, public.distributions_investisseurs, public.prets,
              public.echeances_prets, public.remboursements_prets, public.verifications_caisse,
              public.situation_investisseurs, public.situation_prets, public.capitaux_engages
  from anon;
