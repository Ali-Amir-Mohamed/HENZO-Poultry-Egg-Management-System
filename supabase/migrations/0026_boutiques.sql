-- =====================================================================
-- HENZO – Boutiques (version complète)
--   * boutiques et vendeurs (un vendeur = une boutique) ;
--   * envois ferme → boutique (Kenfack / employé), réception confirmée par
--     le vendeur (écart signalé) ;
--   * stock de chaque boutique, par origine (bande / lot) : chaque vente
--     écoule d'abord les plus anciens et compte dans la bande d'origine ;
--   * vente en boutique au prix fixé (le vendeur ne le change pas),
--     comptant seulement (espèces, Mobile Money), même hors ligne ;
--   * caisse de chaque boutique, clôture du soir (écart signalé),
--     versement à la ferme validé par la finance (réparti chair / pondeuses) ;
--   * pertes et inventaire ; une bande ne se clôture pas tant qu'il en
--     reste des poulets en boutique.
-- Le vendeur ne voit que sa boutique : rien de la ferme.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 0025 (lancé seul).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Boutiques, vendeurs
-- ---------------------------------------------------------------------
create table public.boutiques (
  id          uuid primary key default gen_random_uuid(),
  ferme_id    uuid not null default public.ferme_actuelle() references public.fermes (id),
  nom         text not null check (trim(nom) <> ''),
  adresse     text,
  telephone   text,
  actif       boolean not null default true,
  created_at  timestamptz not null default now()
);
create trigger journal after insert or update on public.boutiques for each row execute function public.journaliser();
alter table public.profiles add column boutique_id uuid references public.boutiques (id);

-- Un vendeur ne voit pas les données de la ferme : pas de « ferme active » pour lui
create or replace function public.ferme_actuelle()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ferme_id from public.profiles where id = auth.uid() and actif and role::text not in ('vendeur', 'investisseur')
$$;

-- Boutique du vendeur connecté
create function public.ma_boutique()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.boutique_id from public.profiles p
  where p.id = auth.uid() and p.actif and p.role::text = 'vendeur'
$$;

-- Accès à une boutique : son vendeur, ou le directeur / l'exploitation / la finance / un employé de la ferme
create function public.acces_boutique(p_boutique uuid, p_roles text[] default array['directeur', 'exploitation', 'finance'])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_boutique = public.ma_boutique()
      or exists (select 1 from public.boutiques b where b.id = p_boutique and b.ferme_id = public.ferme_actuelle()
                 and public.role_actuel()::text = any (p_roles))
$$;

-- Affecter un compte vendeur à une boutique (directeur)
create function public.affecter_boutique(p_identifiant text, p_boutique uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.a_role('directeur') then raise exception 'Seul le directeur affecte les vendeurs'; end if;
  if not exists (select 1 from public.boutiques where id = p_boutique and ferme_id = public.ferme_actuelle()) then
    raise exception 'Boutique introuvable';
  end if;
  select id into v_user from public.profiles where lower(identifiant) = lower(trim(p_identifiant)) and role::text = 'vendeur';
  if v_user is null then raise exception 'Aucun compte vendeur avec l''identifiant %', p_identifiant; end if;
  update public.profiles set boutique_id = p_boutique where id = v_user;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Prix boutique (fixés par la direction ; le vendeur ne les change pas)
--    produit : poulet | oeufs | poule_reformee ; forme : vivant | abattu | decoupe | - ;
--    unité : piece | kg | plateau
-- ---------------------------------------------------------------------
create table public.prix_boutique (
  id          uuid primary key default gen_random_uuid(),
  ferme_id    uuid not null default public.ferme_actuelle() references public.fermes (id),
  produit     text not null check (produit in ('poulet', 'oeufs', 'poule_reformee')),
  forme       text not null default '-' check (forme in ('vivant', 'abattu', 'decoupe', '-')),
  unite       text not null check (unite in ('piece', 'kg', 'plateau')),
  prix        numeric(14, 0) not null check (prix > 0),
  date_debut  date not null default current_date,
  saisi_par   uuid not null default auth.uid() references public.profiles (id),
  created_at  timestamptz not null default now(),
  check ((produit = 'oeufs') = (forme = '-')),
  check (produit = 'oeufs' or unite <> 'plateau'),
  check (produit <> 'oeufs' or unite in ('piece', 'plateau'))
);
create trigger journal after insert on public.prix_boutique for each row execute function public.journaliser();

create view public.prix_boutique_actuels with (security_invoker = true) as
select distinct on (ferme_id, produit, forme, unite) ferme_id, produit, forme, unite, prix, date_debut
from public.prix_boutique
where date_debut <= current_date
order by ferme_id, produit, forme, unite, date_debut desc, created_at desc;

-- ---------------------------------------------------------------------
-- 3. Envois ferme → boutique ; chaque ligne reçue est un « lot » du stock boutique
--    (poulet / poule réformée : en sujets ; œufs : en œufs)
-- ---------------------------------------------------------------------
create table public.envois_boutique (
  id          uuid primary key default gen_random_uuid(),
  ferme_id    uuid not null references public.fermes (id),
  boutique_id uuid not null references public.boutiques (id),
  date_envoi  date not null default current_date,
  statut      text not null default 'en_route' check (statut in ('en_route', 'recu')),
  notes       text,
  envoye_par  uuid not null default auth.uid() references public.profiles (id),
  recu_par    uuid references public.profiles (id),
  recu_le     timestamptz,
  created_at  timestamptz not null default now()
);
create table public.envois_lignes (
  id                uuid primary key default gen_random_uuid(),
  envoi_id          uuid not null references public.envois_boutique (id),
  ferme_id          uuid not null references public.fermes (id),
  boutique_id       uuid not null references public.boutiques (id),
  produit           text not null check (produit in ('poulet', 'oeufs', 'poule_reformee')),
  bande_id          uuid references public.bandes (id),
  lot_id            uuid references public.lots_pondeuses (id),
  quantite_envoyee  integer not null check (quantite_envoyee > 0),
  quantite_recue    integer check (quantite_recue >= 0),
  restant           integer not null default 0 check (restant >= 0),
  created_at        timestamptz not null default now(),
  check ((produit = 'poulet') = (bande_id is not null)),
  check ((produit in ('oeufs', 'poule_reformee')) = (lot_id is not null))
);
create index on public.envois_lignes (boutique_id, produit);
create index on public.envois_lignes (bande_id);
create trigger journal after insert or update on public.envois_boutique for each row execute function public.journaliser();

-- Historique des mouvements du stock boutique
create table public.mouvements_stock_boutique (
  id                 bigint generated always as identity primary key,
  ferme_id           uuid not null references public.fermes (id),
  boutique_id        uuid not null references public.boutiques (id),
  ligne_id           uuid references public.envois_lignes (id),
  produit            text not null,
  type_mouvement     text not null check (type_mouvement in ('reception', 'vente', 'perte', 'inventaire', 'annulation')),
  quantite           integer not null,
  motif              text,
  vente_boutique_id  uuid,
  saisi_par          uuid default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now()
);
create index on public.mouvements_stock_boutique (boutique_id, created_at desc);

create view public.stock_boutiques with (security_invoker = true) as
select l.boutique_id, l.produit, sum(l.restant)::integer as stock
from public.envois_lignes l join public.envois_boutique e on e.id = l.envoi_id
where e.statut = 'recu'
group by l.boutique_id, l.produit;

-- Poulets d'une bande encore en boutique (ou en route)
create function public.en_boutique(p_bande uuid, p_lot uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when e.statut = 'en_route' then l.quantite_envoyee else l.restant end), 0)::integer
  from public.envois_lignes l join public.envois_boutique e on e.id = l.envoi_id
  where (p_bande is not null and l.bande_id = p_bande) or (p_lot is not null and l.lot_id = p_lot and l.produit = 'poule_reformee')
$$;

-- Créer un envoi (directeur, exploitation, employé)
-- p_lignes : [{ "produit": "poulet", "bande_id": "…", "quantite": 50 }, { "produit": "oeufs", "lot_id": "…", "quantite": 600 }]
create function public.creer_envoi(p_boutique uuid, p_lignes jsonb, p_date date default current_date, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.boutiques;
  v_envoi uuid;
  l jsonb;
  v_q integer;
  v_dispo integer;
begin
  if not public.a_role('directeur', 'exploitation', 'employe') then raise exception 'Seuls la direction, l''exploitation et les employés envoient en boutique'; end if;
  select * into b from public.boutiques where id = p_boutique and ferme_id = public.ferme_actuelle() and actif;
  if b.id is null then raise exception 'Boutique introuvable'; end if;
  if jsonb_array_length(coalesce(p_lignes, '[]'::jsonb)) = 0 then raise exception 'Rien à envoyer'; end if;
  insert into public.envois_boutique (ferme_id, boutique_id, date_envoi, notes) values (b.ferme_id, b.id, coalesce(p_date, current_date), p_notes)
  returning id into v_envoi;
  for l in select * from jsonb_array_elements(p_lignes) loop
    v_q := (l ->> 'quantite')::integer;
    if coalesce(v_q, 0) <= 0 then continue; end if;
    if l ->> 'produit' = 'poulet' then
      v_dispo := public.oiseaux_restants((l ->> 'bande_id')::uuid, null) - public.en_boutique((l ->> 'bande_id')::uuid);
      if v_q > v_dispo then raise exception 'Il ne reste que % poulets disponibles à la ferme dans cette bande', greatest(v_dispo, 0); end if;
      insert into public.envois_lignes (envoi_id, ferme_id, boutique_id, produit, bande_id, quantite_envoyee)
      values (v_envoi, b.ferme_id, b.id, 'poulet', (l ->> 'bande_id')::uuid, v_q);
    elsif l ->> 'produit' = 'poule_reformee' then
      v_dispo := public.oiseaux_restants(null, (l ->> 'lot_id')::uuid) - public.en_boutique(null, (l ->> 'lot_id')::uuid);
      if v_q > v_dispo then raise exception 'Il ne reste que % poules disponibles dans ce lot', greatest(v_dispo, 0); end if;
      insert into public.envois_lignes (envoi_id, ferme_id, boutique_id, produit, lot_id, quantite_envoyee)
      values (v_envoi, b.ferme_id, b.id, 'poule_reformee', (l ->> 'lot_id')::uuid, v_q);
    elsif l ->> 'produit' = 'oeufs' then
      select stock_oeufs into v_dispo from public.stock_oeufs;
      if v_q > coalesce(v_dispo, 0) then raise exception 'Stock d''œufs insuffisant à la ferme (% œufs)', greatest(coalesce(v_dispo, 0), 0); end if;
      insert into public.envois_lignes (envoi_id, ferme_id, boutique_id, produit, lot_id, quantite_envoyee)
      values (v_envoi, b.ferme_id, b.id, 'oeufs', (l ->> 'lot_id')::uuid, v_q);
    else
      raise exception 'Produit inconnu';
    end if;
  end loop;
  return v_envoi;
end;
$$;

-- Réception par le vendeur : nombre réellement reçu par ligne ; écart signalé.
-- p_recus : [{ "ligne_id": "…", "recu": 48 }] (absent = tout reçu)
create function public.recevoir_envoi(p_envoi uuid, p_recus jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.envois_boutique;
  l public.envois_lignes;
  v_recu integer;
  v_manque integer := 0;
  v_nom text;
begin
  select * into e from public.envois_boutique where id = p_envoi for update;
  if e.id is null or not public.acces_boutique(e.boutique_id, array['directeur', 'exploitation']) then raise exception 'Envoi introuvable'; end if;
  if e.statut <> 'en_route' then raise exception 'Cet envoi est déjà réceptionné'; end if;
  select nom into v_nom from public.boutiques where id = e.boutique_id;
  for l in select * from public.envois_lignes where envoi_id = e.id loop
    select (x ->> 'recu')::integer into v_recu from jsonb_array_elements(coalesce(p_recus, '[]'::jsonb)) x where (x ->> 'ligne_id')::uuid = l.id;
    v_recu := coalesce(v_recu, l.quantite_envoyee);
    if v_recu < 0 or v_recu > l.quantite_envoyee then raise exception 'Quantité reçue impossible (0 à %)', l.quantite_envoyee; end if;
    update public.envois_lignes set quantite_recue = v_recu, restant = v_recu where id = l.id;
    insert into public.mouvements_stock_boutique (ferme_id, boutique_id, ligne_id, produit, type_mouvement, quantite)
    values (e.ferme_id, e.boutique_id, l.id, l.produit, 'reception', v_recu);
    if v_recu < l.quantite_envoyee then
      v_manque := v_manque + (l.quantite_envoyee - v_recu);
      -- Oiseaux manquants : ils ne sont plus à la ferme → comptés comme pertes de la bande / du lot
      if l.produit in ('poulet', 'poule_reformee') then
        insert into public.mortalites (ferme_id, bande_id, lot_id, nombre, cause, saisi_par)
        values (e.ferme_id, l.bande_id, case when l.produit = 'poule_reformee' then l.lot_id end, l.quantite_envoyee - v_recu,
                'Manquant à la réception (boutique ' || v_nom || ')', auth.uid());
      end if;
    end if;
  end loop;
  update public.envois_boutique set statut = 'recu', recu_par = auth.uid(), recu_le = now() where id = e.id;
  if v_manque > 0 then
    perform public.notifier(e.ferme_id, r, 'ecart_envoi', format('Boutique %s : envoi reçu avec %s manquant(s)', v_nom, v_manque), '/boutique')
    from unnest(array['directeur', 'exploitation']::public.role_utilisateur[]) r;
  end if;
end;
$$;

-- Écouler le stock d'une boutique, plus anciens d'abord ; renvoie les portions [{ligne_id, quantite}]
create function public.ecouler_stock_boutique(p_boutique uuid, p_produit text, p_quantite integer, p_type text,
                                              p_motif text default null, p_vente uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  v_reste integer := p_quantite;
  v_pris integer;
  v_out jsonb := '[]'::jsonb;
begin
  for l in select li.* from public.envois_lignes li join public.envois_boutique e on e.id = li.envoi_id
           where li.boutique_id = p_boutique and li.produit = p_produit and e.statut = 'recu' and li.restant > 0
           order by e.recu_le, li.created_at for update of li loop
    exit when v_reste = 0;
    v_pris := least(l.restant, v_reste);
    update public.envois_lignes set restant = restant - v_pris where id = l.id;
    insert into public.mouvements_stock_boutique (ferme_id, boutique_id, ligne_id, produit, type_mouvement, quantite, motif, vente_boutique_id)
    values (l.ferme_id, p_boutique, l.id, p_produit, p_type, -v_pris, p_motif, p_vente);
    v_out := v_out || jsonb_build_object('ligne_id', l.id, 'quantite', v_pris, 'bande_id', l.bande_id, 'lot_id', l.lot_id);
    v_reste := v_reste - v_pris;
  end loop;
  if v_reste > 0 then raise exception 'Stock insuffisant en boutique (il manque %)', v_reste; end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Caisse de chaque boutique (espèces, Mobile Money ; suivie par activité)
-- ---------------------------------------------------------------------
create table public.mouvements_caisse_boutique (
  id                 bigint generated always as identity primary key,
  ferme_id           uuid not null references public.fermes (id),
  boutique_id        uuid not null references public.boutiques (id),
  date_mouvement     date not null default current_date,
  sens               text not null check (sens in ('entree', 'sortie')),
  montant            numeric(16, 0) not null check (montant > 0),
  mode               text not null check (mode in ('especes', 'mobile_money')),
  activite           public.activite not null,
  nature             text not null check (nature in ('vente', 'versement', 'annulation')),
  vente_boutique_id  uuid,
  versement_id       uuid,
  libelle            text,
  saisi_par          uuid default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now()
);
create index on public.mouvements_caisse_boutique (boutique_id, created_at desc);

create view public.soldes_boutiques with (security_invoker = true) as
select b.id as boutique_id, b.nom, m.mode, a.activite,
       coalesce((select sum(case when c.sens = 'entree' then c.montant else -c.montant end)
                 from public.mouvements_caisse_boutique c where c.boutique_id = b.id and c.mode = m.mode and c.activite = a.activite), 0) as solde
from public.boutiques b
cross join (values ('especes'), ('mobile_money')) m (mode)
cross join (values ('chair'::public.activite), ('pondeuse'::public.activite)) a (activite);

-- ---------------------------------------------------------------------
-- 5. Ventes en boutique (insertion directe : marche hors ligne)
--    Le prix est TOUJOURS celui fixé par la direction (le prix envoyé est ignoré).
-- ---------------------------------------------------------------------
alter table public.ventes add column boutique_id uuid references public.boutiques (id);
alter table public.ventes add column forme text check (forme in ('vivant', 'abattu', 'decoupe'));

create table public.ventes_boutique (
  id                 uuid primary key default gen_random_uuid(),
  ferme_id           uuid references public.fermes (id),
  boutique_id        uuid not null references public.boutiques (id),
  date_vente         date not null default current_date,
  produit            text not null check (produit in ('poulet', 'oeufs', 'poule_reformee')),
  forme              text check (forme in ('vivant', 'abattu', 'decoupe')),
  unite              text not null check (unite in ('piece', 'kg', 'plateau')),
  quantite           numeric(12, 2) not null check (quantite > 0),
  nombre_sujets      integer check (nombre_sujets > 0),
  prix_unitaire      numeric(14, 0),
  montant            numeric(16, 0),
  mode_paiement      text not null check (mode_paiement in ('especes', 'mobile_money')),
  client_nom         text,
  client_telephone   text,
  annulee            boolean not null default false,
  motif_annulation   text,
  annulee_par        uuid references public.profiles (id),
  annulee_le         timestamptz,
  saisi_par          uuid not null default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now()
);
create index on public.ventes_boutique (boutique_id, date_vente desc);
-- Lien : ventes d'origine (bande / lot) ↔ vente boutique
alter table public.ventes add column vente_boutique_id uuid references public.ventes_boutique (id);
create index on public.ventes (vente_boutique_id);
create trigger journal after insert or update on public.ventes_boutique for each row execute function public.journaliser();

create function public.avant_vente_boutique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ferme uuid;
  v_opp integer;
  v_besoin integer;
  v_stock integer;
begin
  if not public.acces_boutique(new.boutique_id, array['directeur', 'exploitation']) then
    raise exception 'Vous ne pouvez pas vendre pour cette boutique';
  end if;
  select ferme_id into v_ferme from public.boutiques where id = new.boutique_id and actif;
  if v_ferme is null then raise exception 'Boutique fermée ou introuvable'; end if;
  new.ferme_id := v_ferme;
  new.annulee := false; new.motif_annulation := null; new.annulee_par := null; new.annulee_le := null;
  new.saisi_par := coalesce(auth.uid(), new.saisi_par);

  if new.produit = 'oeufs' then
    new.forme := null;
    if new.unite not in ('piece', 'plateau') then raise exception 'Les œufs se vendent à la pièce ou au plateau'; end if;
    new.nombre_sujets := null;
    select oeufs_par_plateau into v_opp from public.fermes where id = v_ferme;
    v_besoin := ceil(new.quantite * case when new.unite = 'plateau' then v_opp else 1 end);
  else
    if new.forme is null then new.forme := 'vivant'; end if;
    if new.produit = 'poule_reformee' and new.forme <> 'vivant' then new.forme := 'vivant'; end if;
    if new.unite not in ('piece', 'kg') then raise exception 'Les poulets se vendent à la pièce ou au kilo'; end if;
    if new.unite = 'piece' then new.nombre_sujets := coalesce(new.nombre_sujets, new.quantite::integer); new.quantite := new.nombre_sujets; end if;
    if coalesce(new.nombre_sujets, 0) <= 0 then raise exception 'Indiquez le nombre de poulets'; end if;
    v_besoin := new.nombre_sujets;
  end if;

  -- Prix fixé par la direction (le vendeur ne le change pas)
  select prix into new.prix_unitaire from public.prix_boutique_actuels
  where ferme_id = v_ferme and produit = new.produit and forme = coalesce(new.forme, '-') and unite = new.unite;
  if new.prix_unitaire is null then
    raise exception 'Pas de prix fixé pour ce produit (% %, %) : demandez à la direction', new.produit, coalesce(new.forme, ''), new.unite;
  end if;
  new.montant := round(new.quantite * new.prix_unitaire);

  select coalesce(stock, 0) into v_stock from public.stock_boutiques where boutique_id = new.boutique_id and produit = new.produit;
  if v_besoin > coalesce(v_stock, 0) then
    raise exception 'Stock insuffisant en boutique : % disponible(s)', coalesce(v_stock, 0);
  end if;
  return new;
end;
$$;
create trigger avant_vente_boutique before insert on public.ventes_boutique
  for each row execute function public.avant_vente_boutique();

-- Après la vente : stock boutique (plus anciens d'abord), vente comptée dans la bande / le lot d'origine, caisse boutique
create function public.apres_vente_boutique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opp integer;
  v_besoin integer;
  v_portions jsonb;
  p jsonb;
  v_q integer;
  v_qte numeric;
begin
  select oeufs_par_plateau into v_opp from public.fermes where id = new.ferme_id;
  v_besoin := case when new.produit = 'oeufs' then ceil(new.quantite * case when new.unite = 'plateau' then v_opp else 1 end) else new.nombre_sujets end;
  v_portions := public.ecouler_stock_boutique(new.boutique_id, new.produit, v_besoin, 'vente', null, new.id);

  for p in select * from jsonb_array_elements(v_portions) loop
    v_q := (p ->> 'quantite')::integer;
    -- part de la quantité vendue (kg, plateaux) correspondant à cette portion
    v_qte := case when new.produit = 'oeufs' and new.unite = 'plateau' then round(v_q::numeric / v_opp, 2)
                  when new.produit = 'oeufs' then v_q
                  when new.unite = 'kg' then round(new.quantite * v_q / new.nombre_sujets, 2)
                  else v_q end;
    if v_qte <= 0 then v_qte := 0.01; end if;
    insert into public.ventes (ferme_id, date_vente, bande_id, lot_id, produit, unite, quantite, prix_unitaire, nombre_sujets,
                               a_credit, mode_paiement, boutique_id, forme, notes, saisi_par, vente_boutique_id)
    values (new.ferme_id, new.date_vente,
            case when new.produit = 'poulet' then (p ->> 'bande_id')::uuid end,
            case when new.produit <> 'poulet' then (p ->> 'lot_id')::uuid end,
            case new.produit when 'poulet' then 'poulets' when 'poule_reformee' then 'poules_reformees'
                             else case when new.unite = 'plateau' then 'plateaux' else 'oeufs' end end,
            new.unite, v_qte, new.prix_unitaire,
            case when new.produit <> 'oeufs' then v_q end,
            false, new.mode_paiement::public.mode_paiement, new.boutique_id, new.forme,
            'Vente boutique', new.saisi_par, new.id);
  end loop;

  insert into public.mouvements_caisse_boutique (ferme_id, boutique_id, date_mouvement, sens, montant, mode, activite, nature, vente_boutique_id, libelle, saisi_par)
  values (new.ferme_id, new.boutique_id, new.date_vente, 'entree', new.montant, new.mode_paiement,
          case when new.produit = 'poulet' then 'chair'::public.activite else 'pondeuse'::public.activite end,
          'vente', new.id, 'Vente ' || new.produit, new.saisi_par);
  return null;
end;
$$;
create trigger apres_vente_boutique after insert on public.ventes_boutique
  for each row execute function public.apres_vente_boutique();

-- Annulation d'une vente boutique (directeur, avec motif) : ventes d'origine, stock et caisse remis
create function public.annulation_vente_boutique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  if tg_op = 'DELETE' then raise exception 'Une vente ne se supprime pas : le directeur peut l''annuler'; end if;
  if old.annulee or not new.annulee or coalesce(trim(new.motif_annulation), '') = ''
     or (to_jsonb(new) - array['annulee', 'motif_annulation', 'annulee_par', 'annulee_le'])
        is distinct from (to_jsonb(old) - array['annulee', 'motif_annulation', 'annulee_par', 'annulee_le']) then
    raise exception 'Une vente ne se modifie pas : seul le directeur peut l''annuler, avec un motif';
  end if;
  if auth.uid() is not null and not public.a_role('directeur') then raise exception 'Seul le directeur annule une vente'; end if;
  new.annulee_par := auth.uid();
  new.annulee_le := now();
  update public.ventes set annulee = true, motif_annulation = 'Annulation vente boutique : ' || new.motif_annulation
  where vente_boutique_id = new.id and not annulee;
  for m in select * from public.mouvements_stock_boutique where vente_boutique_id = new.id and type_mouvement = 'vente' loop
    update public.envois_lignes set restant = restant - m.quantite where id = m.ligne_id;
    insert into public.mouvements_stock_boutique (ferme_id, boutique_id, ligne_id, produit, type_mouvement, quantite, motif, vente_boutique_id)
    values (m.ferme_id, m.boutique_id, m.ligne_id, m.produit, 'annulation', -m.quantite, new.motif_annulation, new.id);
  end loop;
  insert into public.mouvements_caisse_boutique (ferme_id, boutique_id, sens, montant, mode, activite, nature, vente_boutique_id, libelle)
  select ferme_id, boutique_id, 'sortie', montant, mode, activite, 'annulation', vente_boutique_id, 'Annulation : ' || new.motif_annulation
  from public.mouvements_caisse_boutique where vente_boutique_id = new.id and nature = 'vente';
  return new;
end;
$$;
create trigger annulation_vente_boutique before update or delete on public.ventes_boutique
  for each row execute function public.annulation_vente_boutique();


-- Les ventes « miroir » des boutiques : pas de caisse ferme, pas d'écart de prix ferme, pas de client obligatoire, pas d'alerte doublon
create or replace function public.apres_vente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.boutique_id is not null then return null; end if;   -- l'argent est dans la caisse de la boutique
  if new.montant_encaisse > 0 then
    perform public.ecrire(new.ferme_id, public.caisse_de(new.ferme_id, public.activite_vente(new), new.mode_paiement),
                          'entree', new.montant_encaisse, 'vente', 'Vente ' || new.produit, new.date_vente, p_vente => new.id);
  end if;
  if new.prix_reference is not null and new.prix_unitaire <> new.prix_reference then
    perform public.notifier(new.ferme_id, 'directeur', 'ecart_prix',
      format('Vente de %s au prix de %s FCFA au lieu de %s FCFA', new.produit, new.prix_unitaire, new.prix_reference));
  end if;
  return null;
end;
$$;

create function public.b_vente_boutique()
returns trigger
language plpgsql
as $$
begin
  if new.boutique_id is not null then new.prix_reference := null; end if;
  return new;
end;
$$;
create trigger b_vente_boutique before insert on public.ventes
  for each row execute function public.b_vente_boutique();

create or replace function public.tiers_obligatoire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seuil numeric := (select seuil_tiers_obligatoire from public.fermes where id = new.ferme_id);
  v_montant numeric;
begin
  if tg_table_name = 'ventes' then
    if (to_jsonb(new) ->> 'boutique_id') is not null then return new; end if;   -- vente boutique au comptant
    v_montant := round((to_jsonb(new) ->> 'quantite')::numeric * (to_jsonb(new) ->> 'prix_unitaire')::numeric);
    if (to_jsonb(new) ->> 'client_id') is null and v_montant > v_seuil then
      raise exception 'Vente de % FCFA : indiquez le client (obligatoire au-delà de % FCFA)', v_montant, v_seuil;
    end if;
  else
    v_montant := (to_jsonb(new) ->> 'montant')::numeric;
    if (to_jsonb(new) ->> 'fournisseur_id') is null and v_montant > v_seuil
       and (to_jsonb(new) ->> 'categorie') not in ('salaires', 'retrait_associe') then
      raise exception 'Dépense de % FCFA : indiquez le fournisseur (obligatoire au-delà de % FCFA)', v_montant, v_seuil;
    end if;
  end if;
  return new;
end;
$$;

-- Doublons : les ventes boutique (souvent identiques) ne sont pas signalées
create or replace function public.signaler_doublon()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_double boolean;
  v_code text;
  v_msg text;
  v_lien text := '/ferme';
begin
  if tg_table_name = 'pontes' then
    v_code := (select code from public.lots_pondeuses where id = new.lot_id);
    select exists (select 1 from public.pontes p where p.id <> new.id and p.lot_id = new.lot_id and p.date_ponte = new.date_ponte
      and p.oeufs_collectes = new.oeufs_collectes) into v_double;
    v_msg := format('Ponte peut-être saisie deux fois : %s œufs, lot %s, le %s', new.oeufs_collectes, v_code, to_char(new.date_ponte, 'DD/MM/YYYY'));
    v_lien := '/ferme/lot/' || new.lot_id;
  else
    if tg_table_name = 'ventes' and (to_jsonb(new) ->> 'boutique_id') is not null then return null; end if;
    v_code := coalesce((select code from public.bandes where id = new.bande_id), (select code from public.lots_pondeuses where id = new.lot_id), '');
    v_lien := case when new.bande_id is not null then '/ferme/bande/' || new.bande_id else '/ferme/lot/' || new.lot_id end;
    if tg_table_name = 'ventes' then
      select exists (select 1 from public.ventes v where v.ferme_id = new.ferme_id and v.id <> new.id and not v.annulee and v.boutique_id is null
        and v.date_vente = new.date_vente and v.produit = new.produit and v.unite = new.unite and v.quantite = new.quantite
        and v.prix_unitaire = new.prix_unitaire and v.bande_id is not distinct from new.bande_id and v.lot_id is not distinct from new.lot_id
        and v.client_id is not distinct from new.client_id) into v_double;
      v_msg := format('Vente peut-être saisie deux fois : %s %s, %s, le %s', new.quantite, new.produit, v_code, to_char(new.date_vente, 'DD/MM/YYYY'));
    else
      if (to_jsonb(new) ->> 'cause') like 'Perte en boutique%' or (to_jsonb(new) ->> 'cause') like 'Manquant à la réception%' then return null; end if;
      select exists (select 1 from public.mortalites m where m.id <> new.id and m.date_constat = new.date_constat and m.nombre = new.nombre
        and m.bande_id is not distinct from new.bande_id and m.lot_id is not distinct from new.lot_id) into v_double;
      v_msg := format('Mortalité peut-être saisie deux fois : %s morts, %s, le %s', new.nombre, v_code, to_char(new.date_constat, 'DD/MM/YYYY'));
    end if;
  end if;
  if v_double then
    perform public.notifier(new.ferme_id, 'exploitation', 'doublon', v_msg, v_lien);
    perform public.notifier(new.ferme_id, 'directeur', 'doublon', v_msg, v_lien);
  end if;
  return null;
end;
$$;

-- Stock d'œufs de la ferme : les œufs envoyés en boutique en sortent ; les ventes boutique ne comptent pas en plus
create or replace view public.stock_oeufs as
with f as (select id, oeufs_par_plateau as opp from public.fermes where id = public.ferme_actuelle()),
calc as (
  select f.opp,
         coalesce((select sum(oeufs_collectes - oeufs_casses) from public.pontes p where p.ferme_id = f.id), 0) as oeufs_bons,
         coalesce((select sum(case v.produit when 'oeufs' then v.quantite when 'plateaux' then v.quantite * f.opp end)
                   from public.ventes v where v.ferme_id = f.id and not v.annulee and v.boutique_id is null and v.produit in ('oeufs', 'plateaux')), 0)
         + coalesce((select sum(l.quantite_envoyee) from public.envois_lignes l where l.ferme_id = f.id and l.produit = 'oeufs'), 0) as oeufs_vendus,
         coalesce((select sum(quantite) from public.ajustements_oeufs a where a.ferme_id = f.id), 0) as ajustements
  from f
)
select oeufs_bons::integer, oeufs_vendus::integer, ajustements::integer,
       (oeufs_bons - oeufs_vendus + ajustements)::integer as stock_oeufs,
       floor((oeufs_bons - oeufs_vendus + ajustements) / opp)::integer as plateaux,
       mod((oeufs_bons - oeufs_vendus + ajustements)::integer, opp) as oeufs_isoles,
       opp as oeufs_par_plateau
from calc
where public.role_actuel() is not null;

-- ---------------------------------------------------------------------
-- 6. Pertes, inventaire, clôture du soir, versements
-- ---------------------------------------------------------------------
create function public.declarer_perte_boutique(p_boutique uuid, p_produit text, p_quantite integer, p_motif text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p jsonb;
  v_nom text;
begin
  if not public.acces_boutique(p_boutique, array['directeur', 'exploitation']) then raise exception 'Boutique introuvable'; end if;
  if coalesce(p_quantite, 0) <= 0 then raise exception 'Indiquez la quantité perdue'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif de la perte'; end if;
  select nom into v_nom from public.boutiques where id = p_boutique;
  for p in select * from jsonb_array_elements(public.ecouler_stock_boutique(p_boutique, p_produit, p_quantite, 'perte', trim(p_motif))) loop
    if p_produit in ('poulet', 'poule_reformee') then
      insert into public.mortalites (ferme_id, bande_id, lot_id, nombre, cause, saisi_par)
      select b.ferme_id, (p ->> 'bande_id')::uuid, case when p_produit = 'poule_reformee' then (p ->> 'lot_id')::uuid end,
             (p ->> 'quantite')::integer, 'Perte en boutique (' || v_nom || ') : ' || trim(p_motif), auth.uid()
      from public.boutiques b where b.id = p_boutique;
    end if;
  end loop;
  perform public.notifier(b.ferme_id, r, 'perte_boutique', format('Boutique %s : perte de %s %s (%s)', v_nom, p_quantite, p_produit, trim(p_motif)), '/boutique')
  from public.boutiques b, unnest(array['directeur', 'exploitation']::public.role_utilisateur[]) r where b.id = p_boutique;
end;
$$;

-- Inventaire : quantité comptée ; un manque est traité comme une perte, un surplus s'ajoute au lot le plus récent
create function public.inventaire_boutique(p_boutique uuid, p_produit text, p_compte integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock integer;
  v_ecart integer;
  v_ligne uuid;
begin
  if not public.acces_boutique(p_boutique, array['directeur', 'exploitation']) then raise exception 'Boutique introuvable'; end if;
  if p_compte is null or p_compte < 0 then raise exception 'Indiquez la quantité comptée'; end if;
  select coalesce(stock, 0) into v_stock from public.stock_boutiques where boutique_id = p_boutique and produit = p_produit;
  v_ecart := p_compte - coalesce(v_stock, 0);
  if v_ecart < 0 then
    perform public.declarer_perte_boutique(p_boutique, p_produit, -v_ecart, 'Écart d''inventaire');
  elsif v_ecart > 0 then
    select li.id into v_ligne from public.envois_lignes li join public.envois_boutique e on e.id = li.envoi_id
    where li.boutique_id = p_boutique and li.produit = p_produit and e.statut = 'recu' order by e.recu_le desc, li.created_at desc limit 1;
    if v_ligne is null then raise exception 'Aucun envoi reçu pour ce produit : impossible d''ajouter du stock'; end if;
    update public.envois_lignes set restant = restant + v_ecart where id = v_ligne;
    insert into public.mouvements_stock_boutique (ferme_id, boutique_id, ligne_id, produit, type_mouvement, quantite, motif)
    select ferme_id, p_boutique, v_ligne, p_produit, 'inventaire', v_ecart, 'Surplus à l''inventaire' from public.boutiques where id = p_boutique;
  end if;
  return v_ecart;
end;
$$;

create table public.clotures_boutique (
  id                 uuid primary key default gen_random_uuid(),
  ferme_id           uuid not null references public.fermes (id),
  boutique_id        uuid not null references public.boutiques (id),
  date_cloture       date not null default current_date,
  especes_attendues  numeric(16, 0) not null,
  especes_comptees   numeric(16, 0) not null check (especes_comptees >= 0),
  ecart              numeric(16, 0) generated always as (especes_comptees - especes_attendues) stored,
  notes              text,
  saisi_par          uuid not null default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now()
);

create function public.cloturer_journee(p_boutique uuid, p_especes_comptees numeric, p_notes text default null)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.boutiques;
  v_attendu numeric;
  v_ecart numeric;
begin
  if not public.acces_boutique(p_boutique, array['directeur', 'finance']) then raise exception 'Boutique introuvable'; end if;
  select * into b from public.boutiques where id = p_boutique;
  select coalesce(sum(solde), 0) into v_attendu from public.soldes_boutiques where boutique_id = p_boutique and mode = 'especes';
  insert into public.clotures_boutique (ferme_id, boutique_id, especes_attendues, especes_comptees, notes)
  values (b.ferme_id, b.id, v_attendu, p_especes_comptees, nullif(trim(coalesce(p_notes, '')), ''));
  v_ecart := p_especes_comptees - v_attendu;
  if v_ecart <> 0 then
    perform public.notifier(b.ferme_id, r, 'ecart_caisse_boutique',
      format('Boutique %s : écart de caisse de %s FCFA à la clôture (compté %s, attendu %s)', b.nom, v_ecart, p_especes_comptees, v_attendu), '/boutique')
    from unnest(array['directeur', 'finance']::public.role_utilisateur[]) r;
  end if;
  return v_ecart;
end;
$$;

create table public.versements_boutique (
  id                uuid primary key default gen_random_uuid(),
  ferme_id          uuid not null references public.fermes (id),
  boutique_id       uuid not null references public.boutiques (id),
  date_versement    date not null default current_date,
  mode              text not null check (mode in ('especes', 'mobile_money')),
  montant_chair     numeric(16, 0) not null default 0 check (montant_chair >= 0),
  montant_pondeuse  numeric(16, 0) not null default 0 check (montant_pondeuse >= 0),
  statut            text not null default 'en_attente' check (statut in ('en_attente', 'valide', 'refuse')),
  motif_refus       text,
  saisi_par         uuid not null default auth.uid() references public.profiles (id),
  valide_par        uuid references public.profiles (id),
  valide_le         timestamptz,
  created_at        timestamptz not null default now(),
  check (montant_chair + montant_pondeuse > 0)
);
create trigger journal after insert or update on public.versements_boutique for each row execute function public.journaliser();

-- Argent disponible pour un versement (solde − versements en attente)
create function public.disponible_versement(p_boutique uuid, p_mode text, p_activite public.activite)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select solde from public.soldes_boutiques where boutique_id = p_boutique and mode = p_mode and activite = p_activite), 0)
       - coalesce((select sum(case when p_activite = 'chair' then montant_chair else montant_pondeuse end)
                   from public.versements_boutique where boutique_id = p_boutique and mode = p_mode and statut = 'en_attente'), 0)
$$;

-- Le vendeur (ou la direction / la finance) enregistre l'argent déposé à la ferme
create function public.demander_versement(p_boutique uuid, p_mode text, p_chair numeric, p_pondeuse numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.boutiques;
  v_id uuid;
begin
  if not public.acces_boutique(p_boutique, array['directeur', 'finance']) then raise exception 'Boutique introuvable'; end if;
  select * into b from public.boutiques where id = p_boutique;
  if coalesce(p_chair, 0) < 0 or coalesce(p_pondeuse, 0) < 0 or coalesce(p_chair, 0) + coalesce(p_pondeuse, 0) <= 0 then
    raise exception 'Indiquez le montant versé';
  end if;
  if coalesce(p_chair, 0) > public.disponible_versement(p_boutique, p_mode, 'chair')
     or coalesce(p_pondeuse, 0) > public.disponible_versement(p_boutique, p_mode, 'pondeuse') then
    raise exception 'Montant supérieur à l''argent de la boutique (chair : % FCFA, pondeuses : % FCFA disponibles)',
      public.disponible_versement(p_boutique, p_mode, 'chair'), public.disponible_versement(p_boutique, p_mode, 'pondeuse');
  end if;
  insert into public.versements_boutique (ferme_id, boutique_id, mode, montant_chair, montant_pondeuse)
  values (b.ferme_id, b.id, p_mode, coalesce(p_chair, 0), coalesce(p_pondeuse, 0)) returning id into v_id;
  perform public.notifier(b.ferme_id, r, 'versement_boutique',
    format('Boutique %s : versement de %s FCFA (%s) à valider', b.nom, coalesce(p_chair, 0) + coalesce(p_pondeuse, 0), p_mode), '/boutique')
  from unnest(array['directeur', 'finance']::public.role_utilisateur[]) r;
  return v_id;
end;
$$;

alter table public.ecritures drop constraint ecritures_nature_check;
alter table public.ecritures add constraint ecritures_nature_check
  check (nature in ('vente', 'encaissement_creance', 'depense', 'paiement_fournisseur', 'solde_initial', 'correction', 'annulation',
                    'apport_investisseur', 'retrait_investisseur', 'versement_investisseur',
                    'pret_recu', 'remboursement_pret', 'ajustement_caisse', 'transfert', 'versement_boutique'));

-- La finance (ou le directeur) valide à réception : l'argent passe de la caisse boutique aux caisses de la ferme
create function public.valider_versement(p_versement uuid, p_accepter boolean, p_motif text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.versements_boutique;
  v_nom text;
  a record;
begin
  if not public.a_role('directeur', 'finance') then raise exception 'Seuls la finance et le directeur valident les versements'; end if;
  select * into v from public.versements_boutique where id = p_versement and ferme_id = public.ferme_actuelle() for update;
  if v.id is null or v.statut <> 'en_attente' then raise exception 'Ce versement n''est plus en attente'; end if;
  select nom into v_nom from public.boutiques where id = v.boutique_id;
  if not p_accepter then
    if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif du refus'; end if;
    update public.versements_boutique set statut = 'refuse', motif_refus = trim(p_motif), valide_par = auth.uid(), valide_le = now() where id = v.id;
    return;
  end if;
  for a in select * from (values ('chair'::public.activite, v.montant_chair), ('pondeuse'::public.activite, v.montant_pondeuse)) x (activite, montant) where x.montant > 0 loop
    insert into public.mouvements_caisse_boutique (ferme_id, boutique_id, sens, montant, mode, activite, nature, versement_id, libelle)
    values (v.ferme_id, v.boutique_id, 'sortie', a.montant, v.mode, a.activite, 'versement', v.id, 'Versement à la ferme');
    perform public.ecrire(v.ferme_id, public.caisse_de(v.ferme_id, a.activite, v.mode::public.mode_paiement), 'entree', a.montant,
                          'versement_boutique', 'Versement boutique ' || v_nom, current_date);
  end loop;
  update public.versements_boutique set statut = 'valide', valide_par = auth.uid(), valide_le = now() where id = v.id;
end;
$$;

-- Une bande ne se clôture pas tant qu'il en reste des poulets en boutique
create function public.controle_cloture_boutique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if new.statut in ('cloture_demandee', 'cloturee') and old.statut is distinct from new.statut then
    v_n := public.en_boutique(new.id);
    if v_n > 0 then raise exception 'Il reste % poulet(s) de la bande % en boutique : vendez-les avant la clôture', v_n, new.code; end if;
  end if;
  return new;
end;
$$;
create trigger controle_cloture_boutique before update of statut on public.bandes
  for each row execute function public.controle_cloture_boutique();

-- ---------------------------------------------------------------------
-- 7. Droits : le vendeur ne voit que SA boutique ; la direction voit tout
-- ---------------------------------------------------------------------
alter table public.boutiques enable row level security;
alter table public.prix_boutique enable row level security;
alter table public.envois_boutique enable row level security;
alter table public.envois_lignes enable row level security;
alter table public.mouvements_stock_boutique enable row level security;
alter table public.mouvements_caisse_boutique enable row level security;
alter table public.ventes_boutique enable row level security;
alter table public.clotures_boutique enable row level security;
alter table public.versements_boutique enable row level security;

create policy boutiques_select on public.boutiques for select to authenticated
  using ((ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'employe')) or id = public.ma_boutique());
create policy boutiques_write on public.boutiques for all to authenticated
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));

create policy prix_boutique_select on public.prix_boutique for select to authenticated
  using (ferme_id = public.ferme_actuelle() or ferme_id = (select ferme_id from public.boutiques where id = public.ma_boutique()));
create policy prix_boutique_insert on public.prix_boutique for insert to authenticated
  with check (ferme_id = public.ferme_actuelle() and saisi_par = auth.uid() and public.a_role('directeur', 'exploitation', 'finance'));

create policy envois_select on public.envois_boutique for select to authenticated
  using ((ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'employe')) or boutique_id = public.ma_boutique());
create policy envois_lignes_select on public.envois_lignes for select to authenticated
  using ((ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance', 'employe')) or boutique_id = public.ma_boutique());
create policy stock_boutique_select on public.mouvements_stock_boutique for select to authenticated
  using ((ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance')) or boutique_id = public.ma_boutique());
create policy caisse_boutique_select on public.mouvements_caisse_boutique for select to authenticated
  using ((ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance', 'exploitation')) or boutique_id = public.ma_boutique());
create policy ventes_boutique_select on public.ventes_boutique for select to authenticated
  using ((ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'exploitation', 'finance')) or boutique_id = public.ma_boutique());
create policy ventes_boutique_insert on public.ventes_boutique for insert to authenticated
  with check (saisi_par = auth.uid() and (boutique_id = public.ma_boutique()
              or (public.a_role('directeur', 'exploitation') and exists (select 1 from public.boutiques b where b.id = boutique_id and b.ferme_id = public.ferme_actuelle()))));
create policy ventes_boutique_update on public.ventes_boutique for update to authenticated   -- annulation (trigger)
  using (ferme_id = public.ferme_actuelle() and public.a_role('directeur'))
  with check (ferme_id = public.ferme_actuelle() and public.a_role('directeur'));
create policy clotures_select on public.clotures_boutique for select to authenticated
  using ((ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance')) or boutique_id = public.ma_boutique());
create policy versements_select on public.versements_boutique for select to authenticated
  using ((ferme_id = public.ferme_actuelle() and public.a_role('directeur', 'finance')) or boutique_id = public.ma_boutique());

-- Le vendeur voit le nom de la ferme et le nombre d'œufs par plateau (reçus, ventes)
create policy fermes_vendeur on public.fermes for select to authenticated
  using (id = (select ferme_id from public.boutiques where id = public.ma_boutique()));

revoke execute on function public.ecouler_stock_boutique(uuid, text, integer, text, text, uuid), public.avant_vente_boutique(),
                          public.apres_vente_boutique(), public.annulation_vente_boutique(), public.controle_cloture_boutique(),
                          public.en_boutique(uuid, uuid), public.disponible_versement(uuid, text, public.activite)
  from public, anon, authenticated;
grant execute on function public.ma_boutique(), public.acces_boutique(uuid, text[]), public.affecter_boutique(text, uuid),
                          public.creer_envoi(uuid, jsonb, date, text), public.recevoir_envoi(uuid, jsonb),
                          public.declarer_perte_boutique(uuid, text, integer, text), public.inventaire_boutique(uuid, text, integer),
                          public.cloturer_journee(uuid, numeric, text), public.demander_versement(uuid, text, numeric, numeric),
                          public.valider_versement(uuid, boolean, text) to authenticated;
revoke all on public.boutiques, public.prix_boutique, public.envois_boutique, public.envois_lignes, public.mouvements_stock_boutique,
              public.mouvements_caisse_boutique, public.ventes_boutique, public.clotures_boutique, public.versements_boutique,
              public.prix_boutique_actuels, public.stock_boutiques, public.soldes_boutiques from anon;
